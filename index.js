const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check - Keeps Railway container stable
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };

// 2. Checkout Route
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

// 3. Webhook Route - The "Shotgun" Update
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

      console.log(`🔍 Processing top-up for: ${userId} (${amount} tokens)`);

      // Prepare ID variations (String vs ObjectId)
      const asObjectId = userId.length === 24 ? new ObjectId(userId) : null;
      const query = { $or: [{ _id: asObjectId }, { _id: userId }, { user: asObjectId }, { user: userId }] };

      // Aggressive update: Targets both nested and top-level balance fields
      const updateData = { 
        $inc: { 
          "balances.tokenCredits": amount, 
          "tokenCredits": amount 
        },
        $set: { 
          "balances.last_topup": new Date(),
          "last_topup": new Date() 
        }
      };

      // Apply to both collections found in your DB
      const updateUsers = await db.collection('users').updateOne(query, updateData);
      const updateBalances = await db.collection('balances').updateOne(query, updateData);

      const modifiedCount = (updateUsers.modifiedCount || 0) + (updateBalances.modifiedCount || 0);

      if (modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to ${userId}`);
      } else {
        console.log(`⚠️ MATCHED BUT NOT MODIFIED: User ${userId} might already have these values.`);
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
