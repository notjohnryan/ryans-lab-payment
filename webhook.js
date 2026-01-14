app.post('/webhook', async (req, res) => {
  console.log("🔔 Webhook Received for Ryan's Lab");
  const data = req.body.data;

  if (data && data.type === 'checkout_session.payment.paid') {
    try {
      const metadata = data.attributes.payload.metadata;
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      const client = new MongoClient(MONGO_URI);
      await client.connect();
      
      const db = client.db("Ryan's Lab"); 
      const collection = db.collection('test'); // Your collection name

      console.log(`🚀 Updating: Adding ${creditsToAdd} to balances.tokenCredits for User: ${userId}`);

      // SEARCH BY _id (The Title)
      // UPDATE balances.tokenCredits (The Folder)
      const result = await collection.updateOne(
        { _id: new ObjectId(userId) }, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd } 
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to the balances folder for User ${userId}`);
      } else {
        console.error(`❌ FAIL: Found the database, but no user has the _id: ${userId}`);
      }

      await client.close();
    } catch (err) {
      console.error("🔥 Webhook/DB Error:", err.message);
    }
  }
  res.status(200).send('OK');
});
