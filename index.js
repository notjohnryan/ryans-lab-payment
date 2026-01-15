const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// This fixes the "Cannot GET /" message so you can see the server is live
app.get('/', (req, res) => {
  res.send("🚀 Ryan's Lab Payment Server is LIVE and connected to the 'test' database.");
});

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  try {
    const data = req.body.data;
    const metadata = data?.attributes?.payload?.metadata;

    if (!metadata || !metadata.userId) return;

    const client = new MongoClient(uri);
    await client.connect();
    
    // We use "test" here because that is the LibreChat default
    const db = client.db("test"); 
    const collection = db.collection('users'); // LibreChat usually stores balances in 'users'

    const userId = metadata.userId;
    const creditsToAdd = parseInt(metadata.token_credits);

    console.log(`🔎 Attempting update for User: ${userId}`);

    const result = await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { "balances.tokenCredits": creditsToAdd } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ SUCCESS: Added ${creditsToAdd} tokens.`);
    } else {
      console.log(`❌ FAIL: User ID ${userId} not found in 'test.users'.`);
    }

    await client.close();
  } catch (err) {
    console.error("🔥 Error:", err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
