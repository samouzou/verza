import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as admin from "firebase-admin";
import * as sgMail from "@sendgrid/mail";


// Send reminders for overdue invoices
export const sendOverdueInvoiceReminders = onSchedule("every 24 hours", async () => {
  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // Query for overdue invoices that need reminders
    const contractsSnapshot = await db
      .collection("contracts")
      .where("invoiceStatus", "in", ["sent", "viewed"])
      .where("dueDate", "<", now)
      .where("lastReminderSentAt", "<", threeDaysAgo)
      .get();

    logger.info(`Found ${contractsSnapshot.size} overdue invoices that need reminders`);

    // Process each overdue invoice
    for (const doc of contractsSnapshot.docs) {
      const contract = doc.data();
      const contractId = doc.id;

      try {
        // Skip if no client email
        if (!contract.clientEmail) {
          logger.warn(`No client email found for contract ${contractId}`);
          continue;
        }

        // Send reminder email
        const msg = {
          to: contract.clientEmail,
          from: process.env.SENDGRID_FROM_EMAIL || "serge@datatrixs.com",
          subject: "Payment Reminder - Overdue Invoice",
          text: `This is a reminder that your payment of $${contract.amount} for ` +
            `contract ${contractId} is overdue. Please process your payment as soon as possible.`,
          html: `
            <h2>Payment Reminder - Overdue Invoice</h2>
            <p>This is a reminder that your payment of $${contract.amount} for ` +
            `contract ${contractId} is overdue.</p>
            <p>Please process your payment as soon as possible to avoid any late fees.</p>
            <p>Thank you,<br>The Verza Team</p>
          `,
        };

        await sgMail.send(msg);

        // Update contract with reminder sent timestamp and add to history
        await doc.ref.update({
          lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: "Payment Reminder Sent",
            details: `To: ${contract.clientEmail}`,
          }),
        });

        // Log the reminder
        await db.collection("emailLogs").add({
          contractId,
          to: contract.clientEmail,
          type: "overdue_payment_reminder",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: "sent",
        });

        logger.info(`Sent overdue payment reminder for contract ${contractId} to ${contract.clientEmail}`);
      } catch (error) {
        logger.error(`Error processing reminder for contract ${contractId}:`, error);
        // Continue with next contract even if one fails
        continue;
      }
    }
  } catch (error) {
    logger.error("Error in sendOverdueInvoiceReminders:", error);
  }
});
