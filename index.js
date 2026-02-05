app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  const client = new MongoClient(process.env.MONGO_URI);

  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) {
      console.log("❌ ERROR: No email found in Webhook Metadata.");
      return;
    }

    // Convert email to lowercase to prevent "Jazz@gmail.com" vs "jazz@gmail.com" errors
    const payMongoEmail = metadata.email.toLowerCase().trim();
    const amount = parseInt(metadata.token_credits);

    await client.connect();
    const db = client.db("test");

    console.log(`🔍 Searching 'users' folder for email: ${payMongoEmail}`);

    // We look for the user. Since your DB uses a String, this should be a direct match.
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${payMongoEmail}$`, 'i') } // This makes the search case-insensitive
    });

    if (!userDoc) {
      console.log(`❌ FAILED: No user found in 'users' folder matching ${payMongoEmail}`);
      await client.close();
      return;
    }

    // Now we have the user! We use their _id to update the 'balances' folder
    const realId = userDoc._id; 
    console.log(`✅ User Found! ID: ${realId}. Updating 'balances' folder...`);

    const updateResult = await db.collection('balances').updateOne(
      { user: realId.toString() }, // Matching the 'user' field from your screenshot
      { 
        $inc: { "tokenCredits": amount },
        $set: { "last_topup": new Date(), "updatedAt": new Date() }
      },
      { upsert: true }
    );

    if (updateResult.modifiedCount > 0 || updateResult.upsertedCount > 0) {
      console.log(`🎉 SUCCESS: Added ${amount} tokens to ${payMongoEmail}`);
    } else {
      console.log("⚠️ DB matched but no tokens were added. Check field names.");
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    await client.close();
  }
});
