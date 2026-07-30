import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

const FORWARD_TO = "sweetpea@tuta.io";
const LOGO_URL = "https://mysweetpea.cc/logo.png";

export default {
  async email(message, env, ctx) {
    const sender = message.from;
    const recipient = message.to;
    const originalSubject = message.headers.get("subject") || "(no subject)";
    const messageId = message.headers.get("Message-ID");

    console.log(
      `Processing email from ${sender} to ${recipient}: ${originalSubject}`,
    );

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
      msg.setSubject(`Re: ${originalSubject}`);

      msg.addMessage({
        contentType: "text/plain; charset=utf-8",
        data: `Thank you for contacting MySweetPea.

Your message has been received.

A person will review it and reply as soon as possible, usually within 24–48 hours.

For account access:
- If you already have an invite code, return to the access form to create your account.
- If you are requesting Full Access, please include the services you are interested in.

This is an automatic confirmation. You do not need to reply to this email unless you have additional information to add.

Best regards,
MySweetPea
https://mysweetpea.cc`,
      });

      msg.addMessage({
        contentType: "text/html; charset=utf-8",
        data: `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#eef4f3;">
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="width:100%;margin:0;padding:0;background-color:#eef4f3;"
    >
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #d7e4e2;border-radius:14px;"
          >
            <tr>
              <td style="padding:32px 32px 12px;text-align:center;">
                <a
                  href="https://mysweetpea.cc"
                  style="color:#2c6874;text-decoration:none;"
                >
                  <img
                    src="${LOGO_URL}"
                    alt="MySweetPea"
                    width="132"
                    style="display:block;width:132px;max-width:100%;height:auto;margin:0 auto;border:0;"
                  >
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#173b42;">
                <h1 style="margin:0;font-size:25px;line-height:1.3;font-weight:700;color:#173b42;">
                  We received your message
                </h1>

                <p style="margin:18px 0 0;font-size:16px;line-height:1.6;color:#39565c;">
                  Thanks for contacting MySweetPea. Your message is in our inbox, and someone will reply as soon as possible—usually within <strong>24–48 hours</strong>.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 8px;">
                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  style="width:100%;background-color:#f1f7f5;border:1px solid #d7e8e3;border-radius:10px;"
                >
                  <tr>
                    <td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">
                      <p style="margin:0 0 10px;font-size:15px;line-height:1.5;font-weight:700;color:#245c57;">
                        Need account access?
                      </p>

                      <p style="margin:0;font-size:14px;line-height:1.6;color:#39565c;">
                        If you already received an invite code, use it on the
                        <a
                          href="https://mysweetpea.cc/form.html"
                          style="color:#2c6874;text-decoration:underline;"
                        >account creation form</a>.
                        If you are requesting Full Access, please include the services you are interested in.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 32px 32px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:#647b7f;">
                  This is an automatic confirmation, so no reply is needed unless you want to add more information.
                </p>

                <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#39565c;">
                  Best regards,<br>
                  <strong style="color:#173b42;">MySweetPea</strong><br>
                  <a
                    href="https://mysweetpea.cc"
                    style="color:#2c6874;text-decoration:underline;"
                  >mysweetpea.cc</a>
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#758a8d;text-align:center;">
            Private, self-hosted, community-funded infrastructure.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      });

      const replyMessage = new EmailMessage(
        recipient,
        sender,
        msg.asRaw(),
      );

      await message.reply(replyMessage);
      console.log("Auto-reply sent successfully");
    } catch (replyError) {
      console.error("Auto-reply failed:", replyError);
    }

    try {
      await message.forward(FORWARD_TO);
      console.log("Forward to Tuta successful");
    } catch (forwardError) {
      console.error("Forward to Tuta failed:", forwardError);
    }
  },
};
