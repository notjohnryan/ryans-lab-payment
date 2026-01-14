app.post('/webhook', async (req, res) => {
  console.log("🔔 Webhook Triggered");
  const data = req.body.data;

  if (data && data.type === 'checkout_session.payment.paid') {
    try {
      const metadata = data.attributes.payload.metadata;
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      const client = new MongoClient(MONGO_URI);
      await client.connect();
      
      const db = client.db(); 
      console.log(`Searching in Database: ${db.databaseName}`); // This confirms the DB name

      const users = db.collection('users'); // Ensure this matches Compass exactly
      
      const result = await users.updateOne(
        { _id: new ObjectId(userId) }, 
        { $inc: { balance: creditsToAdd } } // Ensure 'balance' matches Compass field
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Added ${creditsToAdd} to User ${userId}`);
      } else {
        console.log(`❌ FAIL: Found 0 users with ID ${userId} in ${db.databaseName}.users`);
      }

      await client.close();
    } catch (err) {
      console.error("🔥 Error during update:", err.message);
    }
  }
  res.status(200).send('OK');
});
