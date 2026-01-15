const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(express.json());

// 1. SETTINGS & LOGGING
const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI;

console.log("🛠️ Starting Ryan's Lab Server...");

// 2. HEALTH CHECK (Ensures Railway sees the app is alive)
app.get('/', (req, res) => {
  res.status(200).send("🚀 Payment Server is ONLINE.");
});

// 3. THE /PAY ROUTE
app.get('/pay', async (req, res) => {
  try {
    const { userId, quantity } = req.query;
    if (!userId) return res.status(400).send("Missing userId");

    const qty = parseInt(quantity) || 1;
    const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };
    const price = PRICING[qty] || 25000;
    const totalTokens = qty * 5000000;

    console.log(`🛒 Checkout: User ${userId} | Qty ${qty}`);

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
            send_email_receipt: true,
            description: `Top-up: ${totalTokens.toLocaleString()} tokens`,
            line_items: [{ amount: price, currency: 'PHP', name: "Token Pack", quantity: qty }],
            metadata: { userId: userId, token_credits: totalTokens.toString() },
            payment_method_types: ['qrph', 'card', 'gcash', 'paymaya'],
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.SUCCESS_URL
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("❌ PayMongo Error:", error.message);
    res.status(500).send("Payment Error");
  }
});

// 4. THE WEBHOOK ROUTE
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');
  const data = req.body.data;

  if (data?.type === 'checkout_session.payment.paid') {
    const metadata = data.attributes.payload?.metadata || data.attributes.metadata;
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const db = client.db("test");
      const users = db.collection('users');
      
      const query = { _id: metadata.userId.length === 24 ? new ObjectId(metadata.userId) : metadata.userId };
      
      await users.updateOne(query, { 
        $inc: { "balances.tokenCredits": parseInt(metadata.token_credits) },
        $set: { "balances.last_topup": new Date() }
      });
      console.log(`✅ Tokens Added to ${metadata.userId}`);
    } catch (err) {
      console.error("❌ DB Error:", err.message);
    } finally {
      await client.close();
    }
  }
});

// 5. START SERVER (Bind to 0.0.0.0 is critical for Railway)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});
