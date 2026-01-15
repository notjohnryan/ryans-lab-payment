const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;

app.post('/webhook', async (req, res) => {
  // 1. Immediately tell PayMongo we got the message (prevents timeouts)
  res.status(200).send('OK');

  console.log("🔔 Webhook Received - Processing Database Update...");
  
  try {
    const data = req.body.data;
    const metadata = data?.attributes?.payload?.metadata;

    if (!metadata) {
      console.log("⚠️ No metadata found in this request.");
      return;
    }

    const userId = metadata.userId;
    const creditsToAdd = parseInt(metadata.token_credits);

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    
    const db = client.db("Ryan's Lab");
    const collection = db.collection('test');

    // 2. Perform the update
    const result = await collection.updateOne(
      { 
        $or: [
          { _id: new ObjectId(userId) },
          { _id: userId }
        ]
      },
      { $inc: { "balances.tokenCredits": creditsToAdd } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ SUCCESS: Added ${creditsToAdd} tokens to User ${userId}`);
    } else {
      console.log(`❌ FAIL: Found database but User ${userId} not found in 'test' collection.`);
    }

    await client.close();
  } catch (err) {
    console.error("🔥 Database Error:", err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Ryan's Lab Payment Server running on port ${PORT}`));
