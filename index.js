const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // for JSON Data parsing

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
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

    // ================= ROUTES =================

    // Sample GET routes
    app.get("/ideas", async (req, res) => {
      try {
        const result = await ideasCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching data", error });
      }
    });

    
    // get route by id
    app.get("/ideas/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const query = { _id: new ObjectId(id) };
        const result = await ideasCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Idea not found" });
        }

        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({
            message: "Error fetching idea or invalid ID",
            error: error.message,
          });
      }
    });



    // Root API
    app.get("/", (req, res) => {
      res.send("IdeaVault Server is running...");
    });

    // Listener
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });

    // Send a ping to confirm connection to mongo db
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // await client.close(); // comment for all time
  }
}
run().catch(console.dir);
