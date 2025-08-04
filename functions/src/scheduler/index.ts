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
          from: process.env.SENDGRID_FROM_EMAIL || "serge@tryverza.com",
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


/**
 * Sends reminders for invoices that are due in exactly 3 days.
 * Runs every 24 hours.
 */
export const sendUpcomingPaymentReminders = onSchedule("every 24 hours", async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(today.getDate() + 3);

    const threeDaysFromNowEnd = new Date(threeDaysFromNow);
    threeDaysFromNowEnd.setHours(23, 59, 59, 999);
    
    // Query for invoices due in 3 days that have not already had a reminder sent in the last few days
    // to avoid re-sending if the job runs multiple times a day or has overlaps.
    const reminderThreshold = new Date();
    reminderThreshold.setDate(reminderThreshold.getDate() - 2);

    const contractsSnapshot = await db
      .collection("contracts")
      .where("invoiceStatus", "in", ["sent", "viewed"])
      .where("dueDate", ">=", threeDaysFromNow)
      .where("dueDate", "<=", threeDaysFromNowEnd)
      .get();
      
    logger.info(`Found ${contractsSnapshot.size} invoices due in 3 days.`);

    for (const doc of contractsSnapshot.docs) {
      const contract = doc.data();
      const contractId = doc.id;
      
      // Additional check to prevent re-sending reminders frequently
      if (contract.lastReminderSentAt && contract.lastReminderSentAt.toDate() > reminderThreshold) {
          logger.info(`Skipping reminder for contract ${contractId}, already sent recently.`);
          continue;
      }

      try {
        if (!contract.clientEmail) {
          logger.warn(`No client email for upcoming reminder on contract ${contractId}`);
          continue;
        }
        
        const dueDateFormatted = new Date(contract.dueDate).toLocaleDateString("en-US", {
            year: "numeric", month: "long", day: "numeric",
        });

        const msg = {
          to: contract.clientEmail,
          from: process.env.SENDGRID_FROM_EMAIL || "serge@tryverza.com",
          subject: `Payment Reminder: Invoice for ${contract.projectName || contract.brand}`,
          text: `This is a reminder that your payment of $${contract.amount} for ` +
                `contract ${contract.projectName || contractId} is due on ${dueDateFormatted}.`,
          html: `
            <h2>Payment Reminder</h2>
            <p>This is a friendly reminder that your payment of <strong>$${contract.amount}</strong> for the project/contract `+
            `'${contract.projectName || contract.brand}' is due on <strong>${dueDateFormatted}</strong>.</p>
            <p>Thank you,<br>The Verza Team</p>
          `,
        };

        await sgMail.send(msg);

        await doc.ref.update({
          lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: "Upcoming Payment Reminder Sent",
            details: `To: ${contract.clientEmail}`,
          }),
        });

        await db.collection("emailLogs").add({
          contractId,
          to: contract.clientEmail,
          type: "upcoming_payment_reminder",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: "sent",
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