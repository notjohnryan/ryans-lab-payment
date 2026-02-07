const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

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
              amount: unitPrice,
              currency: 'PHP', 
              name: `Ryan's Lab: ${totalTokens / 1000000}M Tokens`, 
              quantity: qty,
              images: ["https://ryanslab.space/logo.png"] 
            }],
            payment_method_types: ['qrph', 'gcash', 'maya'],
            success_url: process.env.SUCCESS_URL,
            metadata: { 
              email: email, 
              token_credits: totalTokens.toString() 
            } 
          }
        }
      }
    };
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    res.status(500).send("Error generating checkout link");
  }
});

// 3. THE UPDATED DOUBLE-LOOKUP WEBHOOK
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

    // --- STEP 1: LOOKUP USER ID IN 'users' ---
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in users collection.`);
      return;
    }

    const userId = userDoc._id; // The 695a9ee5... ID
    console.log(`🔍 Found User ID: ${userId}. Now searching balances...`);

    // --- STEP 2: LOOKUP BALANCE RECORD IN 'balances' ---
    // We look for the record where the 'user' column matches our User ID
    const balanceDoc = await db.collection('balances').findOne({ 
      $or: [
        { user: userId },
        { user: userId.toString() }
      ]
    });

    if (!balanceDoc) {
      console.log(`⚠️ No existing balance record for user ${userId}. Creating one...`);
      // Fallback: If no record exists, create one with the user link
      await db.collection('balances').insertOne({
        user: userId,
        tokenCredits: tokensToAdd,
        updatedAt: new Date()
      });
      return;
    }

    // --- STEP 3: UPDATE USING THE BALANCE _id ---
    // This is the 695b5bf9... ID you mentioned
    const balanceRecordId = balanceDoc._id; 
    console.log(`🎯 Targeted Balance ID: ${balanceRecordId}. Adding Tokens...`);

    const updateResult = await db.collection('balances').updateOne(
      { _id: balanceRecordId }, // Strictly update the balance folder's own ID
      { 
        $inc: { "tokenCredits": tokensToAdd },
        $set: { 
          "last_topup": new Date(),
          "updatedAt": new Date() 
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Added ${tokensToAdd} to Balance ID: ${balanceRecordId}`);
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ONLINE ON PORT ${PORT}`));
