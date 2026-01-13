const express = require('express');
const axios = require('axios');
const app = express();

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 

app.get('/pay', async (req, res) => {
  const options = {
    method: 'POST',
    url: 'https://api.paymongo.com/v1/checkout_sessions',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      // PayMongo requires the secret key to be base64 encoded with a colon at the end
      authorization: `Basic ${Buffer.from(PAYMONGO_SECRET + ':').toString('base64')}`
    },
    data: {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          line_items: [{
            amount: 25000, 
            currency: 'PHP',
            name: "Ryan's Lab: 5M Tokens",
            quantity: 1
          }],
          // Added 'qrph' for broader bank support
          payment_method_types: ['qrph'],
          success_url: SUCCESS_URL,
          cancel_url: SUCCESS_URL
        }
      }
    }
  };

  try {
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("PayMongo Error:", error.response ? error.response.data : error.message);
    res.status(500).send("Payment System Error. Please contact Ryan.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Payment server running on port ${PORT}`));
