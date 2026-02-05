const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => {
  console.log("💓 Health check ping received");
  res.status(200).send("SERVER IS ALIVE");
});

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (Starts the Session)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const qty = parseInt(quantity) || 1;
    const totalPrice = PRICING[qty] || 25000;
    
    const unitPrice = Math.floor(totalPrice / qty); 
    const totalTokens = qty * 5000000;
    const tokenDisplay = `${totalTokens / 1000000}M`;

    console.log(`🛒 Creating Session: ${email} | Qty: ${qty}`);

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
              name: `Ryan's Lab: ${tokenDisplay} Tokens`, 
              quantity: qty 
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
    console.error("🔥 Pay Route Error:", error.message);
    res.status(500).send("Error generating checkout link");
  }
});

// 3. THE WEBHOOK (Updates the Database)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received from PayMongo");
  
  // Important: Always respond 200 to PayMongo immediately
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) {
      console.log("⚠️ Webhook ignored: No metadata/email found.");
      return;
    }

    const userEmail = metadata.email.trim();
    const amountToAdd = parseInt(metadata.token_credits);

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test"); // Based on your 'test' storage name

    // STEP A: Find the user ID from the 'users' folder using the Email String
    console.log(`🔍 Searching 'users' for: ${userEmail}`);
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ FAILED: Email ${userEmail} not found in 'users' collection.`);
      return;
    }

    const userId = userDoc._id;
    console.log(`✅ User Found! Internal ID: ${userId}`);

    // STEP B: Update the 'balances' folder
    // We match the 'user' field using both ObjectId and String formats
    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { user: userId },           // Matches if stored as ObjectId
          { user: userId.toString() }  // Matches if stored as String
        ] 
      },
      { 
        $inc: { "tokenCredits": amountToAdd },
        $set: { 
          "last_topup": new Date(), 
          "updatedAt": new Date() 
        }
      },
      { upsert: true } // Creates a record if one doesn't exist
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Added ${amountToAdd} tokens to existing record for ${userEmail}`);
    } else if (updateResult.upsertedCount > 0) {
      console.log(`🎉 SUCCESS: Created NEW balance record for ${userEmail}`);
    } else {
      console.log(`⚠️ DB matched but no changes were made for ${userEmail}`);
    }

  } catch (err) {
    console.error("🔥 WEBHOOK CRITICAL ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER ONLINE ON PORT ${PORT}`);
});
