const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios'); // Ensure you have axios installed
const app = express();

app.use(express.json());

// 1. The Home Page (Health Check)
app.get('/', (req, res) => {
  res.send("🚀 Ryan's Lab Payment Server is LIVE.");
});

// 2. THE CHECKOUT ROUTE (This is what was missing!)
app.get('/checkout', async (req, res) => {
  const { userId, amount, tokens } = req.query;

  if (!userId || !amount) {
    return res.status(400).send("Missing userId or amount");
  }

  try {
    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY).toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            description: `Top-up: ${tokens} Tokens`,
            line_items: [{ amount: parseInt(amount) * 100, currency: 'PHP', name: 'Token Pack', quantity: 1 }],
            payment_method_types: ['gcash', 'card', 'paymaya'],
            success_url: process.env.SUCCESS_URL || 'https://chat.ryanslab.space',
            metadata: { userId: userId, token_credits: tokens.toString() }
          }
        }
      }
    };

    const response = await axios.request(options);
    // Redirect the user to the PayMongo Checkout Page
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (err) {
    console.error("Checkout Error:", err.response?.data || err.message);
    res.status(500).send("Failed to create checkout session");
  }
});

// 3. THE WEBHOOK ROUTE (For database updates)
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');
  try {
    const data = req.body.data;
    const metadata = data?.attributes?.payload?.metadata || data?.attributes?.metadata;
    if (!metadata || !metadata.userId) return;

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");
    const collection = db.collection('users');

    await collection.updateOne(
      { _id: new ObjectId(metadata.userId) },
      { $inc: { "balances.tokenCredits": parseInt(metadata.token_credits) } }
    );
    await client.close();
    console.log(`✅ Tokens added to ${metadata.userId}`);
  } catch (err) {
    console.error("Webhook Error:", err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Listening on ${PORT}`));
