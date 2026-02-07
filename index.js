const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => {
  res.status(200).send("PAYMENT SERVER IS ONLINE");
});

// Pricing in Cents (25000 = ₱250.00)
const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    
    if (!email) {
      return res.status(400).send("Email is required to checkout.");
    }

    const qty = parseInt(quantity) || 1;
    const totalPrice = PRICING[qty] || 25000;
    const unitPrice = Math.floor(totalPrice / qty); 
    const totalTokens = (qty * 5000000).toString(); 

    console.log(`🛒 Creating PayMongo Session for: ${email}`);

    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        // Make sure PAYMONGO_SECRET_KEY is correct in Railway Variables
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true, 
            show_description: true,
            billing: { email: email.toString() },
            line_items: [{ 
              amount: unitPrice,
              currency: 'PHP', 
              name: `Ryan's Lab: ${qty * 5}M Tokens`, 
              quantity: qty 
            }],
            payment_method_types: ['qrph', 'gcash', 'maya'],
            success_url: process.env.SUCCESS_URL, 
            metadata: { 
              email: email.toString(), 
              token_credits: totalTokens 
            } 
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);

  } catch (error) {
    // 🔍 THIS WILL SHOW THE EXACT PAYMONGO ERROR IN RAILWAY LOGS
    if (error.response) {
      console.error("🔥 PAYMONGO REJECTION:", JSON.stringify(error.response.data.errors));
    } else {
      console.error("🔥 SERVER ERROR:", error.message);
    }
    res.status(500).send("Checkout Error. Check Railway logs for details.");
  }
});

// 3. THE WEBHOOK
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

    // Lookup user in the users folder
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in DB.`);
      return;
    }

    // Force strict ObjectID matching for the balances folder
    const targetId = new ObjectId(userDoc._id);

    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { _id: targetId }, 
          { user: targetId } 
        ] 
      },
      { 
        $inc: { "tokenCredits": amountToAdd },
        $set: { 
          "last_topup": new Date(), 
          "updatedAt": new Date() 
        }
      },
      { upsert: true } 
    );

    console.log(`🎉 SUCCESS: Added ${amountToAdd} to ID: ${targetId}`);

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server online on port ${PORT}`);
});
