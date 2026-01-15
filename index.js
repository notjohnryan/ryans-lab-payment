const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check - MUST BE FIRST
app.get('/', (req, res) => {
  res.status(200).send("SERVER IS ALIVE");
});

// 2. Pricing Logic
const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };

app.get('/pay', async (req, res) => {
  console.log("📥 Pay request received");
  try {
    const { userId, quantity } = req.query;
    const qty = parseInt(quantity) || 1;
    const price = PRICING[qty] || 25000;
    
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
            payment_method_types: ['gcash', 'card', 'paymaya'],
            success_url: process.env.SUCCESS_URL,
            metadata: { userId, token_credits: (qty * 5000000).toString() }
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("Pay Error:", error.message);
    res.status(500).send("Payment Error");
  }
});

app.post('/webhook', async (req, res) => {
    // Webhook logic remains same but connection happens only when called
    res.status(200).send('OK');
});

// 3. The Port Logic - Bind to 0.0.0.0
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EXECUTED: Server listening on ${PORT}`);
});
