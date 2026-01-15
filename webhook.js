app.post('/webhook', async (req, res) => {
  // 1. Respond to PayMongo immediately to prevent timeouts
  res.status(200).send('OK'); 
  
  const data = req.body.data;
  if (data && data.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      const attributes = data.attributes || {};
      const payload = attributes.payload || attributes;
      const metadata = payload.metadata;
      
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      console.log(`💰 Webhook Success: User [${userId}] | Credits [${creditsToAdd}]`);

      await client.connect();
      const db = client.db("test"); 
      const collection = db.collection('users');

      // Handle both ObjectId and String formats for the _id
      const query = { 
        _id: userId.length === 24 ? new ObjectId(userId) : userId 
      };

      const result = await collection.updateOne(
        query, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd },
          $set: { "balances.last_topup": new Date() }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ DATABASE UPDATED: +${creditsToAdd.toLocaleString()} tokens for ${userId}`);
      } else {
        console.error(`❌ DB UPDATE FAILED: User ${userId} not found in test.users`);
      }
    } catch (err) {
      console.error("🔥 Webhook/DB Error:", err.message);
    } finally {
      await client.close();
    }
  }
});
