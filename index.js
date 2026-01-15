const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check - Essential for Railway stability
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };

// 2. Checkout Session Creator
app.get('/pay', async (req, res) => {
  try {
    const { userId, quantity } = req.query;
    const qty = parseInt(quantity) || 1;
    const price = PRICING[qty] || 25000;
    const totalTokens = qty * 5000000;

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
            payment_method_types: ['qrph'],
            success_url: process.env.SUCCESS_URL,
            metadata: { userId, token_credits: totalTokens.toString() }
          }
        }
      }
    };
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    res.status(500).send("Error creating payment session");
  }
});

// 3. The Webhook - "Bulletproof" Version
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

      console.log(`🔍 Processing: User ${userId} | Amount ${amount}`);

      // ADDRESSING THE ObjectId vs String issue
      const asObjectId = userId.length === 24 ? new ObjectId(userId) : null;
      const query = { $or: [{ user: userId }, { user: asObjectId }, { _id: userId }, { _id: asObjectId }] };

      // THE "EVERYTHING" UPDATE
      const updateData = { 
        $inc: { 
          "tokenCredits": amount, 
          "balances.tokenCredits": amount 
        },
        $set: { 
          "last_topup": new Date(),
          "updatedAt": new Date()
        }
      };

      // Try updating 'balances' collection first (priority for Balance.tsx)
      const balanceResult = await db.collection('balances').updateOne(query, updateData);
      
      if (balanceResult.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Updated 'balances' collection for ${userId}`);
      } else {
        // Fallback to 'users' collection
        console.log("⚠️ No change in 'balances', trying 'users' collection...");
        const userResult = await db.collection('users').updateOne(query, updateData);
        
        if (userResult.modifiedCount > 0) {
          console.log(`✅ SUCCESS: Updated 'users' collection for ${userId}`);
        } else {
          console.log(`❌ FAILED: User ${userId} found but no fields were modified. Check field names!`);
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
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Listening on ${PORT}`));
