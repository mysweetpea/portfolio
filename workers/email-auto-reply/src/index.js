try {
  const reply = new EmailMessage(
    recipient,
    sender,
    [
      `From: MySweetPea <${recipient}>`,
      `To: ${sender}`,
      `Subject: Re: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      "Thank you for contacting MySweetPea.",
      "",
      "Your message was received. We will reply within 24-48 hours.",
      "",
      "MySweetPea",
      "https://mysweetpea.cc",
    ].join("\r\n"),
  );

  await message.reply(reply);
  console.log("Minimal auto-reply sent successfully");
} catch (replyError) {
  console.error(
    "Auto-reply failed:",
    replyError?.stack || replyError?.message || String(replyError),
  );
}
