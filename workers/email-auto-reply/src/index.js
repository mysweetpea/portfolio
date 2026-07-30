try {
  const msg = createMimeMessage();

  const messageId = message.headers.get("message-id");

  if (messageId) {
    msg.setHeader("In-Reply-To", messageId);
    msg.setHeader("References", messageId);
  }

  msg.setSender({
    name: "MySweetPea",
    addr: recipient,
  });

  msg.setRecipient(sender);
  msg.setSubject(`Re: ${subject}`);

  msg.addMessage({
    contentType: "text/plain; charset=utf-8",
    data: `Thank you for contacting MySweetPea.

Your message has been received. We will reply within 24–48 hours.

MySweetPea
https://mysweetpea.cc`,
  });

  const replyMessage = new EmailMessage(
    recipient,
    sender,
    msg.asRaw(),
  );

  await message.reply(replyMessage);

  console.log("Auto-reply sent successfully");
} catch (replyError) {
  console.error(
    "Auto-reply failed:",
    replyError?.stack || replyError?.message || String(replyError),
  );
}
