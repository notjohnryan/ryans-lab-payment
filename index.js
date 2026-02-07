const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

app.get('/', (req, res) => res.status(200).send("SYNC SERVER ACTIVE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const qty = parseInt(quantity) || 1;
    const totalPrice = PRICING[qty] || 25000;
    const unitPrice = Math.floor(totalPrice / qty); 
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
            send_email_receipt: true, 
            billing: { email: email },
            line_items: [{ 
              amount: unitPrice, currency: 'PHP', 
              name: `Ryan's Lab: ${totalTokens / 1000000}M Tokens`, 
              quantity: qty,
              images: ["https://ryanslab.space/logo.png"] 
            }],
            payment_method_types: ['qrph'],
            success_url: process.env.SUCCESS_URL,
            metadata: { email: email, token_credits: totalTokens.toString() } 
          }
        }
      }
    };
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    res.status(500).send("Error");
  }
});

app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const { data } = req.body;
    const resource = data?.attributes?.data || data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;
    if (!metadata || !metadata.email) return;

    const userEmail = metadata.email.trim();
    const tokensToAdd = Number(metadata.token_credits);

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    // 1. Find the User first
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found.`);
      return;
    }

    const userId = userDoc._id; // This is the $oid: 695a9ee5...
    const now = new Date();

    console.log(`🔍 Syncing tokens for User: ${userEmail} (${userId})`);

    // --- TASK A: UPDATE THE 'users' COLLECTION ---
    // You have tokenCredits directly in the user folder. Update them there too.
    await db.collection('users').updateOne(
      { _id: userId },
      { 
        $inc: { "tokenCredits": tokensToAdd },
        $set: { "last_topup": now, "updatedAt": now }
      }
    );

    // --- TASK B: UPDATE THE 'balances' COLLECTION ---
    // We target the 'user' field (which is a string "695a9ee5...")
    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { user: userId.toString() }, 
          { user: userId }
        ] 
      },
      { 
        $inc: { 
          "tokenCredits": tokensToAdd,           // The root field
          "balances.tokenCredits": tokensToAdd   // The nested field in your JSON
        },
        $set: { 
          "last_topup": now,
          "balances.last_topup": now,
          "updatedAt": now 
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Synced all token fields for ${userEmail}`);
    } else {
      console.log(`⚠️ Balance record match failed, check the 'user' field format.`);
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SYNC SERVER ONLINE`));
