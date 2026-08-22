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

    // 1. Get ideas with Search, Filter & Date Range
    app.get("/ideas", async (req, res) => {
      const {
        search = "",
        category = "",
        fromDate = "",
        toDate = "",
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

    // 2. Get single idea by ID
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

    // 3. Post new idea
    app.post("/ideas", async (req, res) => {
      try {
        const newIdeaData = req.body;

        const newIdea = {
          ...newIdeaData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await ideasCollection.insertOne(newIdea);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({
          message: "Error creating idea",
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
