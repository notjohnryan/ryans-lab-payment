app.post('/webhook', async (req, res) => {
  console.log("🔔 Webhook Received for Ryan's Lab");
  const data = req.body.data;

  if (data && data.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(MONGO_URI);
    try {
      const metadata = data.attributes.payload.metadata;
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      console.log(`🚀 Processing: UserID [${userId}] | Credits [${creditsToAdd}]`);

      await client.connect();
      const db = client.db("Ryan's Lab"); 
      const collection = db.collection('test'); 

      // 1. DIAGNOSTIC: Try to find the user first to see what's wrong
      const findById = await collection.findOne({ _id: new ObjectId(userId) });
      const findByString = await collection.findOne({ _id: userId });
      const findByUserField = await collection.findOne({ user: userId });

      console.log(`🔎 Search Results: ObjectId match: ${!!findById} | String match: ${!!findByString} | 'user' field match: ${!!findByUserField}`);

      // 2. THE UPDATE: Use whichever method worked
      const query = findById ? { _id: new ObjectId(userId) } : 
                    findByString ? { _id: userId } : 
                    { user: userId };

      const result = await collection.updateOne(
        query, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to balances.tokenCredits for ${userId}`);
      } else {
        console.error(`❌ FAIL: Could not update user. Query used: ${JSON.stringify(query)}`);
      }

    } catch (err) {
      console.error("🔥 Webhook/DB Error:", err.message);
    } finally {
      await client.close();
    }
  }
  res.status(200).send('OK');
});
