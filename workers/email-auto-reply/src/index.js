import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

const FORWARD_TO = "sweetpea@tuta.io";

export default {
  async email(message, env, ctx) {
    const sender = message.from;
    const recipient = message.to;
    const subject = message.headers.get("subject") || "(no subject)";
    const messageId = message.headers.get("message-id");

    console.log(`Processing email from ${sender} to ${recipient}: ${subject}`);

    try {
      const msg = createMimeMessage();

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

    try {
      await message.forward(FORWARD_TO);
      console.log("Forward to Tuta successful");
    } catch (forwardError) {
      console.error(
        "Forward to Tuta failed:",
        forwardError?.stack || forwardError?.message || String(forwardError),
      );
    }
  },
};
