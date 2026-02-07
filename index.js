const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (With Branding Image)
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
              images: ["https://ryanslab.space/logo.png"] // Your brand logo
            }],
            payment_method_types: ['qrph'],
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

// 3. THE WEBHOOK (The Specific Fix for your DB Structure)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) return;

    const userEmail = metadata.email.trim();
    const amountToAdd = parseInt(metadata.token_credits);

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    // STEP A: Get the User's _id from 'users' folder
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in 'users' collection.`);
      return;
    }

    const userId = userDoc._id; // This is 695a9ee531b028706a9633f7
    console.log(`✅ Found User: ${userEmail} with ID: ${userId}`);

    // STEP B: Update 'balances' folder targeting the 'user' column
    // We ignore the _id of the balance record and match the 'user' field instead
    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { user: userId },             // Match as ObjectId
          { user: userId.toString() }    // Match as String (since it's 'Mixed')
        ] 
      },
      { 
        $inc: { "tokenCredits": amountToAdd },
        $set: { 
          "last_topup": new Date(), 
          "updatedAt": new Date() 
        }
      },
      { upsert: false } // We use false first to see if we hit the existing record
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Updated tokens for user field: ${userId}`);
    } else {
      console.log(`⚠️ Match failed for user field ${userId}. Checking if we need to create it...`);
      // If no record exists at all for this user, then we upsert
      await db.collection('balances').updateOne(
        { user: userId }, 
        { 
          $inc: { "tokenCredits": amountToAdd },
          $set: { "updatedAt": new Date() }
        },
        { upsert: true }
      );
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER ON PORT ${PORT}`));
