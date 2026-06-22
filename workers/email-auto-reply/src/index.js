import { createMimeMessage } from "mimetext";

export default {
  async email(message, env, ctx) {
    const sender = message.from;
    const recipient = message.to;
    const subject = message.headers.get("subject") || "(no subject)";

    console.log(`Processing email from ${sender} to ${recipient}: ${subject}`);

    // Send auto-reply
    const msg = createMimeMessage();
    const messageId = message.headers.get("Message-ID");
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
      contentType: "text/plain",
      data: "Thank you for contacting MySweetPea! I've received your message and will get back to you within 24-48 hours.\n\nBest regards,\nSweetPea\nmysweetpea.cc",
    });
    msg.addMessage({
      contentType: "text/html",
      data: "<p>Thank you for contacting MySweetPea! I've received your message and will get back to you within <strong>24-48 hours</strong>.</p><p>Best regards,<br>SweetPea<br><a href='https://mysweetpea.cc'>mysweetpea.cc</a></p>",
    });

    const replyMessage = new EmailMessage(
      recipient,
      sender,
      msg.asRaw(),
    );
    await message.reply(replyMessage);

    // Forward original email to your Tuta inbox
    await message.forward("YOUR_TUTA_EMAIL@tuta.io");
  },
};
