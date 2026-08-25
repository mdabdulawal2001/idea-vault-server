const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    // Database & Collections
    const db = client.db("ideaVaultDB");
    const ideasCollection = db.collection("ideas");
    const commentsCollection = db.collection("comments");

    // Send a ping to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");

    //  HELPER FUNCTION
    async function convertStringDatesToISODate() {
      try {
        const result = await ideasCollection.updateMany(
          {
            $or: [
              { createdAt: { $type: "string" } },
              { updatedAt: { $type: "string" } },
            ],
          },
          [
            {
              $set: {
                createdAt: { $toDate: "$createdAt" },
                updatedAt: { $toDate: "$updatedAt" },
              },
            },
          ],
        );
        if (result.modifiedCount > 0) {
          console.log(
            `Converted ${result.modifiedCount} string dates to ISODate format.`,
          );
        }
      } catch (err) {
        console.error("Date conversion error:", err.message);
      }
    }

    // fix data after server running
    await convertStringDatesToISODate();

    // ================= ROUTES =================

    // Root API
    app.get("/", (req, res) => {
      res.send("IdeaVault Server is running...");
    });

    // Get ideas with Search, Filter & Date Range
    app.get("/ideas", async (req, res) => {
      const {
        search = "",
        category = "",
        fromDate = "",
        toDate = "",
        authorId = "",
      } = req.query;

      try {
        const query = {};

        // Search by title (Case-insensitive)
        if (search) {
          query.title = {
            $regex: search,
            $options: "i",
          };
        }

        // Filter by category
        if (category) {
          query.category = category;
        }

        // Filter by authorId
        if (authorId) {
          query.authorId = authorId;
        }

        // Filter by date range
        if (fromDate || toDate) {
          query.createdAt = {};

          if (fromDate) {
            query.createdAt.$gte = new Date(`${fromDate}T00:00:00.000Z`);
          }

          if (toDate) {
            query.createdAt.$lte = new Date(`${toDate}T23:59:59.999Z`);
          }
        }

        const result = await ideasCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching ideas:", error);
        res.status(500).send({
          message: "Error fetching ideas",
          error: error.message,
        });
      }
    });

    // post comments
    app.post("/comments", async (req, res) => {
      try {
        const { ideaId, ideaTitle, userId, userName, userImage, text } =
          req.body;

        // ================= VALIDATION =================

        if (!ideaId || !userId || !text?.trim()) {
          return res.status(400).send({
            success: false,
            message: "Required fields are missing",
          });
        }

        // ================= IDEA ID VALIDATION =================

        if (!ObjectId.isValid(ideaId)) {
          return res.status(400).send({
            success: false,
            message: "Invalid idea ID",
          });
        }

        // ================= NEW COMMENT =================

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

        // ================= INSERT =================

        const result = await commentsCollection.insertOne(newComment);

        // ================= SUCCESS =================

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

    // get comments
    app.get("/comments/idea/:ideaId", async (req, res) => {
      try {
        const { ideaId } = req.params;

        // ================= ID VALIDATION =================

        if (!ObjectId.isValid(ideaId)) {
          return res.status(400).send({
            success: false,
            message: "Invalid idea ID",
          });
        }

        // ================= GET COMMENTS =================

        const comments = await commentsCollection
          .find({
            ideaId: new ObjectId(ideaId),
          })
          .sort({
            createdAt: -1,
          })
          .toArray();

        // ================= SUCCESS =================

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

    // GET COMMENTS BY USER ID 

    app.get("/comments/user/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        // ================= USER ID VALIDATION =================

        if (!userId) {
          return res.status(400).send({
            success: false,
            message: "User ID is required",
          });
        }

        // ================= GET USER COMMENTS =================

        const comments = await commentsCollection
          .find({
            userId: userId,
          })
          .sort({
            createdAt: -1,
          })
          .toArray();

        // ================= SUCCESS =================

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

    // patch comments
    app.patch("/comments/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { text } = req.body;

        // ================= ID VALIDATION =================

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid comment ID",
          });
        }

        // ================= BODY VALIDATION =================

        if (!text?.trim()) {
          return res.status(400).send({
            success: false,
            message: "Comment text is required",
          });
        }

        // ================= UPDATE COMMENT =================

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            text: text.trim(),
            updatedAt: new Date(),
          },
        };

        const result = await commentsCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Comment not found",
          });
        }

        // Updated comment payload fetch
        const updatedComment = await commentsCollection.findOne(filter);

        // ================= SUCCESS =================

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

    // delete comments
    app.delete("/comments/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // ================= ID VALIDATION =================

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid comment ID",
          });
        }

        // ================= DELETE COMMENT =================

        const filter = { _id: new ObjectId(id) };
        const result = await commentsCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Comment not found",
          });
        }

        // ================= SUCCESS =================

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

    // category route
    app.get("/idea-categories", async (req, res) => {
      try {
        const categories = await ideasCollection.distinct("category");

        res.send(categories);
      } catch (error) {
        console.error("Error fetching categories:", error);

        res.status(500).send({
          message: "Error fetching categories",
          error: error.message,
        });
      }
    });

    // Get single idea by ID
    app.get("/ideas/:id", async (req, res) => {
      const id = req.params.id;

      // Validate ObjectId format
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ID format" });
      }

      try {
        const query = { _id: new ObjectId(id) };
        const result = await ideasCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Idea not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Error fetching idea",
          error: error.message,
        });
      }
    });

    // get trending ideas
    app.get("/trending", async (req, res) => {
      try {
        const result = await ideasCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching trending ideas:", error);
        res.status(500).send({
          message: "Error fetching trending ideas",
          error: error.message,
        });
      }
    });

    // Post new idea
    app.post("/ideas", async (req, res) => {
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
          authorId,
          authorName,
          authorPhoto,
        } = req.body;

        // ================= VALIDATION =================

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

        // ================= NEW IDEA =================

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

          // ================= AUTHOR INFO =================

          authorId: authorId,
          authorName: authorName?.trim() || "Unknown User",
          authorPhoto: authorPhoto || "",

          // ================= TIMESTAMPS =================

          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // ================= INSERT =================

        const result = await ideasCollection.insertOne(newIdea);

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

    // Patch current idea
    app.patch("/ideas/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // ================= ID VALIDATION =================

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

        // ================= VALIDATION =================

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

        // ================= BUDGET VALIDATION =================

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

        // ================= UPDATE DATA =================

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

        // ================= UPDATE =================

        const result = await ideasCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: updatedIdea,
          },
        );

        // ================= NOT FOUND =================

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Idea not found",
          });
        }

        // ================= SUCCESS =================

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

    // Delete current idea
    app.delete("/ideas/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // ================= ID VALIDATION =================

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid idea ID",
          });
        }

        // ================= DELETE =================

        const result = await ideasCollection.deleteOne({
          _id: new ObjectId(id),
        });

        // ================= NOT FOUND =================

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Idea not found",
          });
        }

        // ================= SUCCESS =================

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
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run().catch(console.dir);

// Listener
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
