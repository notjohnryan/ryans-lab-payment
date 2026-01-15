const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. Checkout Session Creator
app.get('/pay', async (req, res) => {
  try {
    const { userId, quantity } = req.query;
    const qty = parseInt(quantity) || 1;
    const price = PRICING[qty] || 25000;
    const totalTokens = qty * 5000000;

    console.log(`🛒 Creating PayMongo Session: User ${userId} | Qty ${qty}`);

    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            line_items: [{ amount: price, currency: 'PHP', name: "Token Pack", quantity: qty }],
            payment_method_types: ['qrph', 'gcash', 'card'],
            success_url: process.env.SUCCESS_URL,
            metadata: { userId, token_credits: totalTokens.toString() }
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("Pay Route Error:", error.message);
    res.status(500).send("Error generating checkout link");
  }
});

// 3. Webhook with Deep Audit Logic
app.post('/webhook', async (req, res) => {
  console.log("⚡ Webhook Received");
  const data = req.body.data;

  if (data?.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    
    try {
      await client.connect();
      const metadata = data.attributes.metadata;
      const db = client.db("test");
      const userId = metadata.userId;
      const amount = parseInt(metadata.token_credits);

      console.log(`🔍 AUDIT START: Looking for User ${userId}`);

      // Prepare ID variations
      const asObjectId = userId.length === 24 ? new ObjectId(userId) : null;
      const query = { $or: [{ user: asObjectId }, { user: userId }, { _id: asObjectId }, { _id: userId }] };

      // STEP 1: Find the document before doing anything
      const docBefore = await db.collection('balances').findOne(query);

      if (!docBefore) {
        console.log("❌ AUDIT FAILED: User not found in 'balances' collection.");
        // Double check the 'users' collection as fallback
        const userDoc = await db.collection('users').findOne(query);
        if (userDoc) {
          console.log("💡 FOUND IN 'USERS' instead. Attempting update there...");
          await db.collection('users').updateOne({ _id: userDoc._id }, { $inc: { "tokenCredits": amount } });
        }
      } else {
        console.log("✅ AUDIT PASSED: Found document. Current DB State:", JSON.stringify(docBefore));

        // STEP 2: Update specifically by the internal _id we just found
        const result = await db.collection('balances').updateOne(
          { _id: docBefore._id },
          { 
            $inc: { "tokenCredits": amount },
            $set: { "last_topup": new Date(), "updatedAt": new Date() }
          }
        );

        if (result.modifiedCount > 0) {
          const docAfter = await db.collection('balances').findOne({ _id: docBefore._id });
          console.log(`🎉 SUCCESS: Token update verified. New Balance: ${docAfter.tokenCredits}`);
        } else {
          console.log("⚠️ ERROR: Document matched but 0 fields modified. Check if 'tokenCredits' is a number.");
        }
      }

    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      return res.status(200).send('OK');
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on ${PORT}`);
});
