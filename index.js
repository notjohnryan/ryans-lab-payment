const express = require('express');
const axios = require('axios');
const app = express();

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 

// Define your pricing structure
const PRICING = {
  tokenPackSize: 5000000, // 5 million tokens per pack
  basePrice: 25000,        // 250 PHP in centavos (PayMongo uses centavos)
  
  // Volume pricing: quantity -> price per pack (in centavos)
  volumeDiscounts: {
    1: 25000,  // 250 PHP for 1 pack
    2: 22500,  // 225 PHP per pack for 2 packs = 450 PHP total
    3: 20000,  // 200 PHP per pack for 3 packs = 600 PHP total
    4: 18000,  // 180 PHP per pack for 4 packs = 720 PHP total
    // Add more discounts as needed
  }
};

app.get('/pay', async (req, res) => {
  try {
    // Parse quantity from query (default to 1)
    let quantity = parseInt(req.query.quantity) || 1;
    
    // Validate quantity (1-10 packs max)
    const MAX_QUANTITY = 10;
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      return res.status(400).send(`Invalid quantity. Please select 1-${MAX_QUANTITY} packs.`);
    }
    
    // Calculate price per pack based on quantity
    const pricePerPack = PRICING.volumeDiscounts[quantity] || PRICING.basePrice;
    const totalPrice = pricePerPack * quantity;
    const totalTokens = quantity * PRICING.tokenPackSize;
    
    // Generate human-readable price display
    const formatPHP = (centavos) => (centavos / 100).toFixed(2);
    
    console.log(`Processing purchase: ${quantity} pack(s)`);
    console.log(`- Price per pack: ${formatPHP(pricePerPack)} PHP`);
    console.log(`- Total price: ${formatPHP(totalPrice)} PHP`);
    console.log(`- Total tokens: ${totalTokens.toLocaleString()}`);
    
    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${Buffer.from(PAYMONGO_SECRET + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            description: `Top-up for ${totalTokens.toLocaleString()} tokens for Ryan's Lab.`,
            line_items: [
              {
                amount: pricePerPack,
                currency: 'PHP',
                name: "Ryan's Lab: 5M Tokens",
                quantity: quantity
              }
            ],
            // Added 'card' for broader payment options
            payment_method_types: ['qrph', 'card'],
            success_url: SUCCESS_URL,
            cancel_url: SUCCESS_URL
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("PayMongo Error:", error.response ? error.response.data : error);
    res.status(500).send("Payment System Error. Please contact Ryan's Lab AI.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Payment server running on port ${PORT}`));
