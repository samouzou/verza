
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import type {UserProfileFirestoreData} from "../../../src/types";

// Send reminders for overdue invoices
export const sendOverdueInvoiceReminders = onSchedule("every 24 hours", async () => {
  try {
    const now = new Date();
    const todayYYYYMMDD = now.toISOString().split("T")[0];
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const contractsSnapshot = await db
      .collection("contracts")
      .where("invoiceStatus", "in", ["sent", "viewed", "overdue"])
      .where("dueDate", "<", todayYYYYMMDD)
      .get();

    const contractsToRemind = contractsSnapshot.docs.filter((doc) => {
      const data = doc.data();
      const lastReminder = data.lastReminderSentAt?.toDate();
      return !lastReminder || lastReminder < threeDaysAgo;
    });

    logger.info(`Found ${contractsToRemind.length} overdue invoices that need reminders`);

    for (const doc of contractsToRemind) {
      const contract = doc.data();
      const contractId = doc.id;

      try {
        if (!contract.clientEmail) {
          logger.warn(`No client email found for contract ${contractId}`);
          continue;
        }

        const creatorDoc = await db.collection("users").doc(contract.userId).get();
        const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
        const creatorName = creator?.displayName || "The Creator";
        const appUrl = process.env.APP_URL || "http://localhost:9002";
        const paymentLink = `${appUrl}/pay/contract/${contractId}`;

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Payment Reminder</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
                'Helvetica Neue', 'Arial', sans-serif; background-color: #f4f4f7; color: #333; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: auto; background-color: #ffffff;
                border: 1px solid #e2e2e2; border-radius: 8px; overflow: hidden; }
                .header { background-color: #f8f8f8; padding: 40px; text-align: center; }
                .header h1 { margin: 0; color: #EF4444; font-size: 24px; }
                .content { padding: 30px; }
                .content p { line-height: 1.6; margin: 0 0 15px; }
                .bold { font-weight: 600; }
                .button-container { text-align: center; margin: 30px 0; }
                .button { background-color: #EF4444; color: #ffffff; padding: 14px 28px; text-decoration: none;
                border-radius: 5px; font-size: 16px; font-weight: 500; }
                .footer { background-color: #f8f8f8; color: #777; padding: 20px; text-align: left; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Payment Overdue</h1>
                </div>
                <div class="content">
                  <p>Hello,</p>
                  <p>This is a reminder that your payment of <span class="bold">$${contract.amount.toLocaleString()}</span>
                  for the project <span class="bold">'${contract.projectName || contract.brand}'</span> is now overdue.</p>
                  <p>To keep things on track, please process your payment at your earliest convenience.
                  You can pay securely via the link below:</p>
                  <div class="button-container">
                    <a href="${paymentLink}" class="button" target="_blank" rel="noopener noreferrer">Pay Invoice Now</a>
                  </div>
                  <p>Thank you,<br/><span class="bold">${creatorName}</span></p>
                </div>
                <div class="footer">
                  <span>Powered by Verza</span>
                </div>
              </div>
            </body>
            </html>
          `;

        const msg = {
          to: contract.clientEmail,
          from: {
            name: creatorName,
            email: process.env.SENDGRID_FROM_EMAIL || "invoices@tryverza.com",
          },
          subject: `Payment Reminder - Invoice for ${contract.projectName || contract.brand} is Overdue`,
          text: `This is a reminder that your payment of $${contract.amount} for
          contract ${contract.projectName || contractId} is overdue.
          Please process your payment as soon as possible. Pay now: ${paymentLink}`,
          html: htmlContent,
          customArgs: {contractId},
        };

        await sgMail.send(msg);

        const emailLogRef = db.collection("emailLogs").doc();
        await emailLogRef.set({
          contractId,
          to: contract.clientEmail,
          type: "overdue_payment_reminder",
          timestamp: admin.firestore.Timestamp.now(),
          status: "sent",
          html: htmlContent,
          subject: msg.subject,
        });

        await doc.ref.update({
          lastReminderSentAt: admin.firestore.Timestamp.now(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.Timestamp.now(),
            action: "Overdue Payment Reminder Sent",
            details: `To: ${contract.clientEmail}`,
            emailLogId: emailLogRef.id,
          }),
          invoiceStatus: "overdue",
        });

        logger.info(`Sent overdue payment reminder for contract ${contractId} to ${contract.clientEmail}`);
      } catch (error) {
        logger.error(`Error processing reminder for contract ${contractId}:`, error);
        continue;
      }
    }
  } catch (error) {
    logger.error("Error in sendOverdueInvoiceReminders:", error);
  }
});


export const sendUpcomingPaymentReminders = onSchedule("every 24 hours", async () => {
  try {
    const now = new Date();
    const todayYYYYMMDD = now.toISOString().split("T")[0];
    const reminderThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const contractsSnapshot = await db
      .collection("contracts")
      .where("invoiceStatus", "in", ["sent", "viewed"])
      .where("dueDate", ">=", todayYYYYMMDD)
      .get();

    const contractsToRemind = contractsSnapshot.docs.filter((doc) => {
      const data = doc.data();
      const lastReminder = data.lastReminderSentAt?.toDate();
      return !lastReminder || lastReminder < reminderThreshold;
    });

    logger.info(`Found ${contractsToRemind.length} open invoices to consider for reminders.`);

    for (const doc of contractsToRemind) {
      const contract = doc.data();
      const contractId = doc.id;

      try {
        if (!contract.clientEmail) {
          logger.warn(`No client email for upcoming reminder on contract ${contractId}`);
          continue;
        }

        const creatorDoc = await db.collection("users").doc(contract.userId).get();
        const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
        const creatorName = creator?.displayName || "The Creator";
        const dueDateFormatted = new Date(contract.dueDate + "T00:00:00").toLocaleDateString("en-US",
          {year: "numeric", month: "long", day: "numeric"});
        const appUrl = process.env.APP_URL || "http://localhost:9002";
        const paymentLink = `${appUrl}/pay/contract/${contractId}`;

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Payment Reminder</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont,
                'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', sans-serif;
                background-color: #f4f4f7; color: #333; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: auto; background-color: #ffffff;
                border: 1px solid #e2e2e2; border-radius: 8px; overflow: hidden; }
                .header { background-color: #f8f8f8; padding: 40px; text-align: center; }
                .header h1 { margin: 0; color: #6B37FF; font-size: 24px; }
                .content { padding: 30px; }
                .content p { line-height: 1.6; margin: 0 0 15px; }
                .bold { font-weight: 600; }
                .button-container { text-align: center; margin: 30px 0; }
                .button { background-color: #6B37FF; color: #ffffff; padding: 14px 28px;
                text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: 500; }
                .footer { background-color: #f8f8f8; color: #777; padding: 20px; text-align: left; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Payment Reminder</h1>
                </div>
                <div class="content">
                  <p>Hello,</p>
                  <p>This is a friendly reminder that your payment of
                  <span class="bold">$${contract.amount.toLocaleString()}</span>
                  for the project <span class="bold">'${contract.projectName || contract.brand}'</span>
                  is due on <span class="bold">${dueDateFormatted}</span>.</p>
                  <p>You can pay securely via the link below:</p>
                  <div class="button-container">
                    <a href="${paymentLink}" class="button" target="_blank" rel="noopener noreferrer">Pay Invoice Now</a>
                  </div>
                  <p>Thank you,<br/><span class="bold">${creatorName}</span></p>
                </div>
                <div class="footer">
                  <span>Powered by Verza</span>
                </div>
              </div>
            </body>
            </html>
          `;

        const msg = {
          to: contract.clientEmail,
          from: {
            name: creatorName,
            email: process.env.SENDGRID_FROM_EMAIL || "invoices@tryverza.com",
          },
          subject: `Payment Reminder: Invoice for ${contract.projectName || contract.brand}`,
          text: `This is a reminder that your payment of $${contract.amount} for contract ${contract.projectName || contractId}
          is due on ${dueDateFormatted}. Pay here: ${paymentLink}`,
          html: htmlContent,
          customArgs: {contractId},
        };

        await sgMail.send(msg);

        const emailLogRef = db.collection("emailLogs").doc();
        await emailLogRef.set({
          contractId,
          to: contract.clientEmail,
          type: "upcoming_payment_reminder",
          timestamp: admin.firestore.Timestamp.now(),
          status: "sent",
          html: htmlContent,
          subject: msg.subject,
        });

        const historyEntry = {
          timestamp: admin.firestore.Timestamp.now(),
          action: "Upcoming Payment Reminder Sent",
          details: `To: ${contract.clientEmail}`,
          emailLogId: emailLogRef.id,
        };

        await doc.ref.update({
          lastReminderSentAt: admin.firestore.Timestamp.now(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
        });

        logger.info(`Sent upcoming payment reminder for contract ${contractId} to ${contract.clientEmail}`);
      } catch (error) {
        logger.error(`Error processing upcoming reminder for contract ${contractId}:`, error);
        continue;
      }
    }
  } catch (error) {
    logger.error("Error in sendUpcomingPaymentReminders:", error);
  }
});
