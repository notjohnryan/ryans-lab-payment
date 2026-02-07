const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => res.status(200).send("RYANS LAB SYSTEM: ONLINE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (Strictly QRPH)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const cleanEmail = email ? email.toString().trim().toLowerCase() : "";
    const qty = parseInt(quantity) || 1;
    const totalTokens = qty * 5000000;
    const totalPrice = PRICING[qty] || 25000;

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
            billing: { email: cleanEmail },
            line_items: [{ 
              amount: Math.floor(totalPrice / qty), 
              currency: 'PHP', 
              name: `Ryan's Lab: ${totalTokens / 1000000}M Tokens`, 
              quantity: qty,
              images: ["https://ryanslab.space/logo.png"] 
            }],
            payment_method_types: ['qrph'], // Your approved method
            success_url: process.env.SUCCESS_URL,
            metadata: { 
              email: cleanEmail, 
              token_credits: totalTokens.toString() 
            } 
          }
        }
      }
    };
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("🔥 Pay Route Error:", error.message);
    res.status(500).send("Error generating checkout link");
  }
});

// 3. THE "ANTI-DUPLICATE" WEBHOOK
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    
    // 🛡️ EXTRACT METADATA (Checks payments array first for Live QRPH mode)
    const payments = body.data?.attributes?.data?.attributes?.payments;
    let metadata = (payments && payments.length > 0) 
      ? payments[0].attributes?.metadata 
      : (body.data?.attributes?.data?.attributes?.metadata || body.data?.attributes?.metadata);

    if (!metadata || !metadata.email) {
      console.log("⚠️ Webhook received but metadata missing.");
      return;
    }

    const userEmail = metadata.email.trim().toLowerCase();
    const tokensToAdd = Number(metadata.token_credits) || 0;

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    console.log(`🔍 Processing sync for: ${userEmail} | Credits to add: ${tokensToAdd}`);

    // --- STEP A: FIND USER ID ---
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in database.`);
      return;
    }

    const userId = userDoc._id;
    const now = new Date();

    // --- STEP B: UPDATE USERS COLLECTION ---
    await db.collection('users').updateOne(
      { _id: userId },
      { 
        $inc: { "tokenCredits": tokensToAdd }, 
        $set: { "last_topup": now, "updatedAt": now } 
      }
    );

    // --- STEP C: UPDATE ALL DUPLICATE BALANCES ---
    // Using updateMany ensures that if a user has multiple balance records 
    // (String ID or ObjectId), they ALL get updated simultaneously.
    const updateResult = await db.collection('balances').updateMany(
      { 
        $or: [
          { user: userId.toString() }, 
          { user: userId }
        ] 
      },
      { 
        $inc: { 
          "tokenCredits": tokensToAdd, 
          "balances.tokenCredits": tokensToAdd 
        },
        $set: { 
          "last_topup": now,
          "balances.last_topup": now,
          "updatedAt": now 
        }
      }
    );

    if (updateResult.matchedCount > 0) {
      console.log(`🎉 SUCCESS: Synced ${updateResult.modifiedCount} records for ${userEmail}`);
    } else {
      // Fallback: Create a record if none exists
      console.log(`⚠️ No balance record found. Creating new one for ${userEmail}`);
      await db.collection('balances').insertOne({
        user: userId.toString(),
        tokenCredits: tokensToAdd,
        balances: { tokenCredits: tokensToAdd, last_topup: now },
        last_topup: now,
        updatedAt: now
      });
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 READY ON PORT ${PORT}`));
