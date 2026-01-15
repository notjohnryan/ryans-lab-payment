const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Instant Health Check - Prevents Railway from killing the app
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };

app.get('/pay', async (req, res) => {
  try {
    const { userId, quantity } = req.query;
    const qty = parseInt(quantity) || 1;
    const price = PRICING[qty] || 25000;
    
    console.log(`🛒 PAY: User ${userId} | Qty ${qty}`);

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
            payment_method_types: ['qrph', 'gcash', 'card', 'paymaya'],
            success_url: process.env.SUCCESS_URL,
            metadata: { userId, token_credits: (qty * 5000000).toString() }
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("Pay Error:", error.message);
    res.status(500).send("Error");
  }
});

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

      // UNIVERSAL SEARCH: Handles both 'users' and 'balances' collections
      const asObjectId = userId.length === 24 ? new ObjectId(userId) : null;
      const query = { $or: [{ _id: asObjectId }, { _id: userId }, { user: asObjectId }, { user: userId }] };

      // Try 'users' collection first
      let result = await db.collection('users').updateOne(query, { 
        $inc: { "balances.tokenCredits": parseInt(metadata.token_credits) },
        $set: { "balances.last_topup": new Date() }
      });

      // If not found, try the 'balances' collection
      if (result.matchedCount === 0) {
        console.log("Searching in 'balances' collection...");
        result = await db.collection('balances').updateOne(query, {
          $inc: { "tokenCredits": parseInt(metadata.token_credits) },
          $set: { "last_topup": new Date() }
        });
      }

      console.log(result.matchedCount > 0 ? `✅ SUCCESS: Credited ${userId}` : `❌ NOT FOUND: ${userId}`);
    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      return res.status(200).send('OK'); // Keeps connection open until work is done
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on ${PORT}`);
});
