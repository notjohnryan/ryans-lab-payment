const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => {
  res.status(200).send("RYANS LAB SERVER IS ONLINE");
});

// 2. THE PAY ROUTE (Ultra-Minimalist)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query;
    
    // Fallback values to ensure no nulls are sent
    const userEmail = email ? email.toString() : "customer@ryanslab.space";
    const qty = parseInt(quantity) || 1;
    const amountInCents = 25000 * qty; // Simplified math

    console.log(`🛒 Attempting session for: ${userEmail}`);

    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        // Forced "Basic" auth format
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            // Simplified line items - PayMongo sometimes fails on complex descriptions
            line_items: [{
              amount: amountInCents,
              currency: 'PHP',
              name: "Token Credits",
              quantity: 1
            }],
            payment_method_types: ['qrph'],
            // HARDCODED Success URL to test if Environment Variable is the issue
            success_url: "https://ryanslab.space",
            metadata: {
              email: userEmail,
              token_credits: (qty * 5000000).toString()
            }
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);

  } catch (error) {
    if (error.response) {
      // Log the full body to see if there's a hidden message
      console.error("🔥 PAYMONGO FULL ERROR:", JSON.stringify(error.response.data));
    } else {
      console.error("🔥 SERVER ERROR:", error.message);
    }
    res.status(500).send("Checkout Failed. Check Dashboard Whitelisting.");
  }
});

// 3. THE WEBHOOK (Strict ObjectId Match)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) return;

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${metadata.email.trim()}$`, 'i') } 
    });

    if (userDoc) {
      const targetId = new ObjectId(userDoc._id);
      await db.collection('balances').updateOne(
        { $or: [{ _id: targetId }, { user: targetId }] },
        { 
          $inc: { "tokenCredits": parseInt(metadata.token_credits) },
          $set: { "updatedAt": new Date() }
        },
        { upsert: true }
      );
      console.log(`🎉 SUCCESS: Credited ${targetId}`);
    }
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on ${PORT}`);
});
