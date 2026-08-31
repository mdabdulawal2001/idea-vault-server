const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
require("dotenv").config();

const app = express();


// ENVIRONMENT VARIABLES


const uri = process.env.MONGODB_URI;
const BETTER_AUTH_URL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;


// BASIC VALIDATION


if (!uri) {
  console.error("❌ MONGODB_URI is missing");
}

if (!BETTER_AUTH_URL) {
  console.error("❌ BETTER_AUTH_URL is missing");
}


// MIDDLEWARE


app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());


// MONGODB


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

// Cached database connection
let db = null;
let dbConnectionPromise = null;

async function connectDB() {
  // Already connected
  if (db) {
    return db;
  }

  // Connection is already in progress
  if (dbConnectionPromise) {
    return dbConnectionPromise;
  }

  dbConnectionPromise = client
    .connect()
    .then(() => {
      db = client.db("ideaVaultDB");

      console.log("✅ MongoDB connected successfully");

      return db;
    })
    .catch((error) => {
      dbConnectionPromise = null;

      console.error("❌ MongoDB connection failed:", error);

      throw error;
    });

  return dbConnectionPromise;
}


// DATABASE COLLECTIONS

async function getCollections() {
  const database = await connectDB();

  return {
    ideasCollection: database.collection("ideas"),
    commentsCollection: database.collection("comments"),
    usersCollection: database.collection("user"),
  };
}


// BETTER AUTH JWKS


let JWKS = null;

function getJWKS() {
  if (!BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is not configured");
  }

  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL(`${BETTER_AUTH_URL}/api/auth/jwks`),
    );
  }

  return JWKS;
}


// VERIFY TOKEN MIDDLEWARE


const verifyToken = async (req, res, next) => {
  const authHeader =
    req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization token is required",
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authorization token is missing",
    });
  }

  try {
    const jwks = getJWKS();

    const { payload } = await jwtVerify(token, jwks, {
      issuer: BETTER_AUTH_URL,
      audience: BETTER_AUTH_URL,
    });

    if (!payload?.sub) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    req.user = {
      id: payload.sub,
      ...payload,
    };

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};


// ROOT ROUTE


app.get("/", (req, res) => {
  res.status(200).json({
    message: "Server is running smoothly!",
    status: "Active",
  });
});


// GET ALL IDEAS
// SEARCH + FILTER + DATE RANGE


app.get("/ideas", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      fromDate = "",
      toDate = "",
      authorId = "",
    } = req.query;

    const { ideasCollection } = await getCollections();

    const query = {};

    // Search by title
    if (search) {
      query.title = {
        $regex: search,
        $options: "i",
      };
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Author filter
    if (authorId) {
      query.authorId = authorId;
    }

    // Date range filter
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        query.createdAt.$gte = new Date(
          `${fromDate}T00:00:00.000Z`,
        );
      }

      if (toDate) {
        query.createdAt.$lte = new Date(
          `${toDate}T23:59:59.999Z`,
        );
      }
    }

    const result = await ideasCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching ideas:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching ideas",
      error: error.message,
    });
  }
});


// GET MY IDEAS


app.get("/my-ideas", verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;

    const { ideasCollection } = await getCollections();

    const result = await ideasCollection
      .find({ authorId: userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching my ideas:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching your ideas",
      error: error.message,
    });
  }
});


// POST COMMENT


app.post("/comments", verifyToken, async (req, res) => {
  try {
    const {
      ideaId,
      ideaTitle,
      userName,
      userImage,
      text,
    } = req.body;

    const userId = req.user.sub;

    if (!ideaId || !text?.trim()) {
      return res.status(400).send({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (!ObjectId.isValid(ideaId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid idea ID",
      });
    }

    const { commentsCollection } = await getCollections();

    const newComment = {
      ideaId: new ObjectId(ideaId),
      ideaTitle: ideaTitle?.trim() || "",

      userId,

      userName: userName?.trim() || "Unknown User",
      userImage: userImage || "",

      text: text.trim(),

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result =
      await commentsCollection.insertOne(newComment);

    res.status(201).send({
      success: true,
      message: "Comment posted successfully",
      comment: {
        ...newComment,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Error creating comment:", error);

    res.status(500).send({
      success: false,
      message: "Error creating comment",
      error: error.message,
    });
  }
});


// GET COMMENTS BY IDEA ID


app.get("/comments/idea/:ideaId", async (req, res) => {
  try {
    const { ideaId } = req.params;

    if (!ObjectId.isValid(ideaId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid idea ID",
      });
    }

    const { commentsCollection } = await getCollections();

    const comments = await commentsCollection
      .find({
        ideaId: new ObjectId(ideaId),
      })
      .sort({
        createdAt: -1,
      })
      .toArray();

    res.status(200).send({
      success: true,
      comments,
    });
  } catch (error) {
    console.error("Error fetching comments:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching comments",
      error: error.message,
    });
  }
});


// GET MY COMMENTS


app.get("/comments/me", verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;

    const { commentsCollection } = await getCollections();

    const comments = await commentsCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      comments,
    });
  } catch (error) {
    console.error("Error fetching user comments:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching user comments",
      error: error.message,
    });
  }
});


// UPDATE COMMENT


app.patch("/comments/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid comment ID",
      });
    }

    if (!text?.trim()) {
      return res.status(400).send({
        success: false,
        message: "Comment text is required",
      });
    }

    const userId = req.user.sub;

    const { commentsCollection } = await getCollections();

    const filter = {
      _id: new ObjectId(id),
      userId,
    };

    const updateDoc = {
      $set: {
        text: text.trim(),
        updatedAt: new Date(),
      },
    };

    const result = await commentsCollection.updateOne(
      filter,
      updateDoc,
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message:
          "Comment not found or you are not the owner",
      });
    }

    const updatedComment =
      await commentsCollection.findOne(filter);

    res.status(200).send({
      success: true,
      message: "Comment updated successfully",
      comment: updatedComment,
    });
  } catch (error) {
    console.error("Update comment error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update comment",
      error: error.message,
    });
  }
});


// DELETE COMMENT


app.delete("/comments/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid comment ID",
      });
    }

    const userId = req.user.sub;

    const { commentsCollection } = await getCollections();

    const filter = {
      _id: new ObjectId(id),
      userId,
    };

    const result =
      await commentsCollection.deleteOne(filter);

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message:
          "Comment not found or you are not the owner",
      });
    }

    res.status(200).send({
      success: true,
      message: "Comment deleted successfully",
    });
  } catch (error) {
    console.error("Delete comment error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to delete comment",
      error: error.message,
    });
  }
});


// GET CATEGORIES

app.get("/idea-categories", async (req, res) => {
  try {
    const { ideasCollection } = await getCollections();

    const categories =
      await ideasCollection.distinct("category");

    res.status(200).send(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching categories",
      error: error.message,
    });
  }
});


// GET SINGLE IDEA


app.get("/ideas/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid ID format",
      });
    }

    const { ideasCollection } = await getCollections();

    const result = await ideasCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        success: false,
        message: "Idea not found",
      });
    }

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching idea:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching idea",
      error: error.message,
    });
  }
});


// TRENDING IDEAS


app.get("/trending", async (req, res) => {
  try {
    const { ideasCollection } = await getCollections();

    const result = await ideasCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("Error fetching trending ideas:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching trending ideas",
      error: error.message,
    });
  }
});


// CREATE NEW IDEA


app.post("/ideas", verifyToken, async (req, res) => {
  try {
    const {
      title,
      shortDescription,
      detailedDescription,
      category,
      tags,
      imageURL,
      estimatedBudget,
      targetAudience,
      problemStatement,
      proposedSolution,
      authorName,
      authorPhoto,
    } = req.body;

    const authorId = req.user.sub;

    if (
      !title?.trim() ||
      !shortDescription?.trim() ||
      !detailedDescription?.trim() ||
      !category?.trim() ||
      !targetAudience?.trim() ||
      !problemStatement?.trim() ||
      !proposedSolution?.trim() ||
      !authorId
    ) {
      return res.status(400).send({
        success: false,
        message: "Required fields are missing",
      });
    }

    const { ideasCollection } = await getCollections();

    const newIdea = {
      title: title.trim(),
      shortDescription: shortDescription.trim(),
      detailedDescription: detailedDescription.trim(),
      category: category.trim(),

      tags: Array.isArray(tags) ? tags : [],

      imageURL: imageURL?.trim() || "",

      estimatedBudget:
        estimatedBudget === null ||
        estimatedBudget === "" ||
        estimatedBudget === undefined
          ? null
          : Number(estimatedBudget),

      targetAudience: targetAudience.trim(),
      problemStatement: problemStatement.trim(),
      proposedSolution: proposedSolution.trim(),

      authorId,
      authorName: authorName?.trim() || "Unknown User",
      authorPhoto: authorPhoto || "",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result =
      await ideasCollection.insertOne(newIdea);

    res.status(201).send({
      success: true,
      message: "Idea published successfully",
      insertedId: result.insertedId,
      idea: {
        ...newIdea,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Error creating idea:", error);

    res.status(500).send({
      success: false,
      message: "Error creating idea",
      error: error.message,
    });
  }
});


// UPDATE IDEA


app.patch("/ideas/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid idea ID",
      });
    }

    const {
      title,
      shortDescription,
      detailedDescription,
      category,
      tags,
      imageURL,
      estimatedBudget,
      targetAudience,
      problemStatement,
      proposedSolution,
    } = req.body;

    if (
      !title?.trim() ||
      !shortDescription?.trim() ||
      !detailedDescription?.trim() ||
      !category?.trim() ||
      !targetAudience?.trim() ||
      !problemStatement?.trim() ||
      !proposedSolution?.trim()
    ) {
      return res.status(400).send({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (
      estimatedBudget !== null &&
      estimatedBudget !== "" &&
      estimatedBudget !== undefined &&
      Number.isNaN(Number(estimatedBudget))
    ) {
      return res.status(400).send({
        success: false,
        message: "Estimated budget must be a valid number",
      });
    }

    const { ideasCollection } = await getCollections();

    const updatedIdea = {
      title: title.trim(),
      shortDescription: shortDescription.trim(),
      detailedDescription: detailedDescription.trim(),
      category: category.trim(),

      tags: Array.isArray(tags) ? tags : [],

      imageURL: imageURL?.trim() || "",

      estimatedBudget:
        estimatedBudget === null ||
        estimatedBudget === "" ||
        estimatedBudget === undefined
          ? null
          : Number(estimatedBudget),

      targetAudience: targetAudience.trim(),
      problemStatement: problemStatement.trim(),
      proposedSolution: proposedSolution.trim(),

      updatedAt: new Date(),
    };

    const result = await ideasCollection.updateOne(
      {
        _id: new ObjectId(id),
        authorId: userId,
      },
      {
        $set: updatedIdea,
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Idea not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Idea updated successfully",
      idea: {
        _id: id,
        ...updatedIdea,
      },
    });
  } catch (error) {
    console.error("Error updating idea:", error);

    res.status(500).send({
      success: false,
      message: "Error updating idea",
      error: error.message,
    });
  }
});


// DELETE IDEA


app.delete("/ideas/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid idea ID",
      });
    }

    const { ideasCollection } = await getCollections();

    const result = await ideasCollection.deleteOne({
      _id: new ObjectId(id),
      authorId: userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Idea not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Idea deleted successfully",
      deletedId: id,
    });
  } catch (error) {
    console.error("Error deleting idea:", error);

    res.status(500).send({
      success: false,
      message: "Error deleting idea",
      error: error.message,
    });
  }
});


// GET PROFILE


app.get("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;

    console.log("JWT USER:", req.user);
    console.log("JWT SUB:", userId);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user ID",
      });
    }

    const { usersCollection } = await getCollections();

    const user = await usersCollection.findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User profile not found",
      });
    }

    res.status(200).send({
      success: true,
      user,
    });
  } catch (error) {
    console.error("GET PROFILE ERROR:", error);

    res.status(500).send({
      success: false,
      message: "Error fetching profile",
    });
  }
});


// UPDATE PROFILE


app.patch("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;

    console.log("UPDATE USER ID:", userId);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user ID",
      });
    }

    const { name, image } = req.body;

    // Validate name
    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).send({
          success: false,
          message: "Name must be a string",
        });
      }

      if (!name.trim()) {
        return res.status(400).send({
          success: false,
          message: "Name is required",
        });
      }

      if (name.trim().length < 2) {
        return res.status(400).send({
          success: false,
          message: "Name must be at least 2 characters",
        });
      }
    }

    // Validate image
    if (
      image !== undefined &&
      image !== null &&
      typeof image !== "string"
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid image URL",
      });
    }

    const updateData = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      updateData.name = name.trim();
    }

    if (image !== undefined) {
      updateData.image = image?.trim() || null;
    }

    const { usersCollection } = await getCollections();

    const result = await usersCollection.updateOne(
      {
        _id: new ObjectId(userId),
      },
      {
        $set: updateData,
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "User profile not found",
      });
    }

    const updatedUser = await usersCollection.findOne({
      _id: new ObjectId(userId),
    });

    res.status(200).send({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);

    res.status(500).send({
      success: false,
      message: "Error updating profile",
    });
  }
});


// 404 ROUTE


app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});


// ERROR HANDLER

app.use((error, req, res, next) => {
  console.error("Unhandled Server Error:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: error.message,
  });
});


// VERCEL EXPORT


module.exports = app;