
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import type {UserProfileFirestoreData, Contract} from "../../../src/types";
import { sendEmailSequence } from "../notifications";

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

    // Initial coarse filter
    const contractsToConsider = contractsSnapshot.docs.filter((doc) => {
      const data = doc.data() as Contract;
      const lastReminder = data.lastReminderSentAt?.toDate();
      return !lastReminder || lastReminder < threeDaysAgo;
    });

    logger.info(`Found ${contractsToConsider.length} overdue invoices to consider for reminders.`);

    for (const doc of contractsToConsider) {
      const contractId = doc.id;
      const contractDocRef = doc.ref;

      try {
        await db.runTransaction(async (transaction) => {
          const freshDoc = await transaction.get(contractDocRef);
          if (!freshDoc.exists) return;

          const contract = freshDoc.data() as Contract;
          const lastReminder = contract.lastReminderSentAt?.toDate();

          // Fine-grained check within the transaction
          if (lastReminder && lastReminder >= threeDaysAgo) {
            logger.info(`Skipping contract ${contractId}, reminder sent recently.`);
            return;
          }

          if (!contract.clientEmail) {
            logger.warn(`No client email found for contract ${contractId}`);
            return;
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
                .button { background-color: #EF4444; color: #ffffff !important; text-decoration: none; padding: 14px 28px;
                border-radius: 5px; font-size: 16px; font-weight: 500; }
                .footer { padding: 20px; text-align: center; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Payment Overdue</h1>
                </div>
                <div class="content">
                  <p>Hello,</p>
                  <p>This is a reminder that the payment of <span class="bold">$${contract.amount.toLocaleString()}</span>
                  for the project <span class="bold">'${contract.projectName || contract.brand}'</span> is now overdue.</p>
                  <p>To keep things on track, please process your payment at your earliest convenience.
                  You can pay securely via the link below:</p>
                  <div class="button-container">
                    <a href="${paymentLink}" class="button" target="_blank" rel="noopener noreferrer">Pay Invoice Now</a>
                  </div>
                  <p>Thank you,<br/><span class="bold">The Verza Team</span></p>
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
          transaction.set(emailLogRef, {
            contractId,
            to: contract.clientEmail,
            type: "overdue_payment_reminder",
            timestamp: admin.firestore.Timestamp.now(),
            status: "sent",
            html: htmlContent,
            subject: msg.subject,
          });

          transaction.update(contractDocRef, {
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
        });
      } catch (error) {
        logger.error(`Error in transaction for overdue contract ${contractId}:`, error);
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

    // Initial coarse filter
    const contractsToConsider = contractsSnapshot.docs.filter((doc) => {
      const data = doc.data() as Contract;
      const lastReminder = data.lastReminderSentAt?.toDate();
      return !lastReminder || lastReminder < reminderThreshold;
    });

    logger.info(`Found ${contractsToConsider.length} open invoices to consider for reminders.`);

    for (const doc of contractsToConsider) {
      const contractId = doc.id;
      const contractDocRef = doc.ref;

      try {
        await db.runTransaction(async (transaction) => {
          const freshDoc = await transaction.get(contractDocRef);
          if (!freshDoc.exists) return;

          const contract = freshDoc.data() as Contract;
          const lastReminder = contract.lastReminderSentAt?.toDate();

          // Fine-grained check within the transaction
          if (lastReminder && lastReminder >= reminderThreshold) {
            logger.info(`Skipping contract ${contractId}, upcoming reminder sent recently.`);
            return;
          }

          if (!contract.clientEmail) {
            logger.warn(`No client email for upcoming reminder on contract ${contractId}`);
            return;
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
                  .button { background-color: #6B37FF; color: #ffffff !important; padding: 14px 28px;
                  text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: 500; }
                  .footer { padding: 20px; text-align: center; font-size: 12px; }
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
                    <p>Thank you,<br/><span class="bold">The Verza Team</span></p>
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
          transaction.set(emailLogRef, {
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

          transaction.update(contractDocRef, {
            lastReminderSentAt: admin.firestore.Timestamp.now(),
            invoiceHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
          });

          logger.info(`Sent upcoming payment reminder for contract ${contractId} to ${contract.clientEmail}`);
        });
      } catch (error) {
        logger.error(`Error in transaction for upcoming contract ${contractId}:`, error);
        continue;
      }
    }
  } catch (error) {
    logger.error("Error in sendUpcomingPaymentReminders:", error);
  }
});


export const processRecurringContracts = onSchedule("every 24 hours", async () => {
  logger.info("Starting processRecurringContracts function.");
  const now = new Date();

  try {
    const q = db.collection("contracts").where("isRecurring", "==", true);
    const snapshot = await q.get();

    if (snapshot.empty) {
      logger.info("No recurring contracts found.");
      return;
    }

    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const contract = doc.data() as Contract;
      const dueDate = new Date(contract.dueDate + "T00:00:00Z"); // Treat date as UTC
      const interval = contract.recurrenceInterval;

      if (!interval || dueDate > now) {
        continue; // Skip if no interval or not due yet
      }

      const nextDueDate = new Date(dueDate);
      if (interval === "monthly") {
        nextDueDate.setUTCMonth(nextDueDate.getUTCMonth() + 1);
      } else if (interval === "quarterly") {
        nextDueDate.setUTCMonth(nextDueDate.getUTCMonth() + 3);
      } else if (interval === "annually") {
        nextDueDate.setUTCFullYear(nextDueDate.getUTCFullYear() + 1);
      } else {
        continue; // Skip for unknown intervals
      }

      // Only create new contract if the next due date is in the past, meaning we should have created it already.
      // This handles the function running and catching up on missed recurrences.
      if (nextDueDate <= now) {
        const newDueDateStr = nextDueDate.toISOString().split("T")[0];

        // Clone contract data
        const newContractData: Omit<Contract, "id"> = {
          ...contract,
          dueDate: newDueDateStr,
          status: "pending", // Reset status for the new period
          invoiceStatus: "none",
          invoiceHistory: [],
          lastReminderSentAt: null,
          isRecurring: false, // The new instance is a one-time fulfillment of the recurring parent
        };

        const newContractRef = db.collection("contracts").doc();
        batch.set(newContractRef, newContractData);

        // Update the original contract's due date to the newly created one's due date
        // so it serves as the basis for the *next* recurrence.
        batch.update(doc.ref, {dueDate: newDueDateStr});

        logger.info(`Scheduled new contract instance for original contract ${doc.id}. New due date: ${newDueDateStr}`);
      }
    }

    await batch.commit();
    logger.info("Recurring contract processing finished.");
  } catch (error) {
    logger.error("Error processing recurring contracts:", error);
  }
});


export const sendDripCampaignEmails = onSchedule("every 24 hours", async () => {
  logger.info("Starting sendDripCampaignEmails function.");
  const now = admin.firestore.Timestamp.now();

  try {
    const usersSnapshot = await db.collection("users")
      .where("emailSequence.nextEmailAt", "<=", now)
      .where("emailSequence.step", "<", 3) // Stop after step 2 (for a 3-email total sequence)
      .get();

    if (usersSnapshot.empty) {
      logger.info("No users due for a drip campaign email.");
      return;
    }

    const batch = db.batch();

    for (const userDoc of usersSnapshot.docs) {
      const user = userDoc.data() as UserProfileFirestoreData;
      if (!user.email || !user.emailSequence) {
        continue;
      }
      
      const currentStep = user.emailSequence.step;
      
      // Send the educational email for the current step
      await sendEmailSequence(user.email, user.displayName || 'Creator', currentStep);
      
      // Prepare user doc for the next step
      const nextStep = currentStep + 1;
      const twoDaysFromNow = new admin.firestore.Timestamp(now.seconds + 2 * 24 * 60 * 60, now.nanoseconds);
      
      batch.update(userDoc.ref, {
        "emailSequence.step": nextStep,
        "emailSequence.nextEmailAt": twoDaysFromNow,
      });
    }

    await batch.commit();
    logger.info(`Processed ${usersSnapshot.size} users for the drip campaign.`);

  } catch (error) {
    logger.error("Error in sendDripCampaignEmails:", error);
  }
});
