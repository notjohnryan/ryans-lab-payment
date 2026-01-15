const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check - Confirms the server is awake and domain is connected
app.get('/', (req, res) => {
  res.send("🚀 Ryan's Lab Payment Server is LIVE and connected to the 'test' database.");
});

// 2. Database Connection - Pulls from your Railway Variables
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

app.post('/webhook', async (req, res) => {
  // Always acknowledge PayMongo immediately with a 200 OK
  res.status(200).send('OK');

  console.log("🔔 Webhook received from PayMongo");

  try {
    const data = req.body.data;
    // PayMongo usually nests metadata inside attributes.payload or attributes
    const attributes = data?.attributes || {};
    const payload = attributes.payload || attributes;
    const metadata = payload.metadata;

    if (!metadata || !metadata.userId) {
      console.log("⚠️ Webhook arrived but metadata or userId is missing.");
      return;
    }

    const userId = metadata.userId;
    const creditsToAdd = parseInt(metadata.token_credits);

    const client = new MongoClient(uri);
    await client.connect();
    
    // Confirmed: Database is 'test', Collection is 'users'
    const db = client.db("test"); 
    const collection = db.collection('users');

    console.log(`🔎 Target: UserID [${userId}] | Adding [${creditsToAdd}] credits`);

    /**
     * THE UPDATE:
     * We use "balances.tokenCredits" (Dot Notation) to reach the nested field.
     * $inc adds the number to the existing total.
     * $set adds a timestamp so you know when it last worked.
     */
    const result = await collection.updateOne(
      { _id: new ObjectId(userId) },
      { 
        $inc: { "balances.tokenCredits": creditsToAdd },
        $set: { "balances.last_topup": new Date() }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ SUCCESS: Added ${creditsToAdd} tokens to user ${userId}.`);
    } else {
      console.error(`❌ FAIL: User ID ${userId} exists but 0 documents were updated.`);
      
      // Diagnostic check: Does the user even exist?
      const userCheck = await collection.findOne({ _id: new ObjectId(userId) });
      if (!userCheck) {
        console.log("❌ DIAGNOSTIC: User ID not found in database. Check if the ID is correct.");
      } else {
        console.log("❌ DIAGNOSTIC: User found, but 'balances.tokenCredits' path might be spelled wrong in Compass.");
      }
    }

    await client.close();
  } catch (err) {
    console.error("🔥 CRITICAL SERVER ERROR:", err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ryan's Lab Payment Server listening on port ${PORT}`);
});
