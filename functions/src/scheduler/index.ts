
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import type {UserProfileFirestoreData, Contract, PaymentMilestone} from "../../../src/types";
import {sendEmailSequence} from "../notifications";

// Send reminders for overdue invoices
export const sendOverdueInvoiceReminders = onSchedule("every 24 hours", async () => {
  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const contractsSnapshot = await db
      .collection("contracts")
      .where("status", "in", ["pending", "invoiced", "partially_paid", "overdue", "sent", "viewed"])
      .get();

    logger.info(`Found ${contractsSnapshot.docs.length} active contracts to check for overdue milestones.`);

    for (const doc of contractsSnapshot.docs) {
      const contract = doc.data() as Contract;
      if (!contract.milestones || contract.milestones.length === 0) continue;

      for (const milestone of contract.milestones) {
        const milestoneDueDate = new Date(milestone.dueDate + "T00:00:00");
        const lastReminder = milestone.lastReminderSentAt?.toDate();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        if (milestone.status !== "paid" && milestoneDueDate < todayMidnight && (!lastReminder || lastReminder < threeDaysAgo)) {
          // This milestone is overdue and needs a reminder
          logger.info(`Found overdue milestone for contract ${doc.id}. Milestone: "${milestone.description}"`);
          
          if (!contract.clientEmail) {
            logger.warn(`No client email for overdue milestone on contract ${doc.id}`);
            continue;
          }

          const creatorDoc = await db.collection("users").doc(contract.userId).get();
          const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
          const creatorName = creator?.displayName || "The Creator";
          const appUrl = process.env.APP_URL || "http://localhost:9002";
          const paymentLink = `${appUrl}/pay/contract/${doc.id}?milestoneId=${milestone.id}`;

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
                  <p>This is a reminder that the payment of <span class="bold">$${milestone.amount.toLocaleString()}</span>
                  for the milestone <span class="bold">'${milestone.description}'</span> on project <span class="bold">'${contract.projectName || contract.brand}'</span> is now overdue.</p>
                  <p>To keep things on track, please process your payment at your earliest convenience.
                  You can pay securely via the link below:</p>
                  <div class="button-container">
                    <a href="${paymentLink}" class="button" target="_blank" rel="noopener noreferrer">Pay Now</a>
                  </div>
                  <p>Thank you,<br/><span class="bold">The Verza Team on behalf of ${creatorName}</span></p>
                </div>
              </div>
            </body>
            </html>
          `;

          const msg = {
            to: contract.clientEmail,
            from: { name: creatorName, email: process.env.SENDGRID_FROM_EMAIL || "invoices@tryverza.com" },
            subject: `Payment Reminder - Milestone for ${contract.projectName || contract.brand} is Overdue`,
            text: `This is a reminder that your payment of $${milestone.amount} for milestone "${milestone.description}" is overdue. Pay now: ${paymentLink}`,
            html: htmlContent,
            customArgs: { contractId: doc.id, milestoneId: milestone.id },
          };

          await sgMail.send(msg);

          const updatedMilestones = contract.milestones.map(m =>
            m.id === milestone.id ? { ...m, lastReminderSentAt: admin.firestore.Timestamp.now() } : m
          );

          await doc.ref.update({
            milestones: updatedMilestones,
            invoiceStatus: 'overdue',
            invoiceHistory: admin.firestore.FieldValue.arrayUnion({
              timestamp: admin.firestore.Timestamp.now(),
              action: `Overdue Reminder Sent for Milestone: ${milestone.description}`,
              details: `To: ${contract.clientEmail}`,
            }),
          });
          
          logger.info(`Sent overdue reminder for contract ${doc.id}, milestone ${milestone.id}`);
        }
      }
    }
  } catch (error) {
    logger.error("Error in sendOverdueInvoiceReminders:", error);
  }
});


export const sendUpcomingPaymentReminders = onSchedule("every 24 hours", async () => {
  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysFromNow = new Date(todayMidnight.getTime() + 7 * 24 * 60 * 60 * 1000);

    const contractsSnapshot = await db
      .collection("contracts")
      .where("status", "in", ["pending", "invoiced", "partially_paid", "sent", "viewed"])
      .get();
      
    logger.info(`Found ${contractsSnapshot.docs.length} active contracts to check for upcoming milestones.`);

    for (const doc of contractsSnapshot.docs) {
        const contract = doc.data() as Contract;
        if (!contract.milestones || contract.milestones.length === 0) continue;

        for (const milestone of contract.milestones) {
            const milestoneDueDate = new Date(milestone.dueDate + 'T00:00:00');
            const lastReminder = milestone.lastReminderSentAt?.toDate();
            const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

            if (milestone.status === 'pending' && milestoneDueDate >= todayMidnight && milestoneDueDate <= sevenDaysFromNow && (!lastReminder || lastReminder < threeDaysAgo)) {
              
              logger.info(`Found upcoming milestone for contract ${doc.id}. Milestone: "${milestone.description}"`);
              
              if (!contract.clientEmail) {
                logger.warn(`No client email for upcoming milestone reminder on contract ${doc.id}`);
                continue;
              }

              const creatorDoc = await db.collection("users").doc(contract.userId).get();
              const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
              const creatorName = creator?.displayName || "The Creator";
              const dueDateFormatted = new Date(milestone.dueDate + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
              const appUrl = process.env.APP_URL || "http://localhost:9002";
              const paymentLink = `${appUrl}/pay/contract/${doc.id}?milestoneId=${milestone.id}`;
              
              const htmlContent = `
                <!DOCTYPE html>
                <html lang="en">
                <head><title>Payment Reminder</title></head>
                <body>
                    <p>Hello,</p>
                    <p>This is a friendly reminder that a payment of <strong>$${milestone.amount.toLocaleString()}</strong> for milestone "<strong>${milestone.description}</strong>" is due on <strong>${dueDateFormatted}</strong>.</p>
                    <a href="${paymentLink}">Pay Now</a>
                    <p>Thank you,<br/>${creatorName}</p>
                </body>
                </html>
              `;

              const msg = {
                  to: contract.clientEmail,
                  from: { name: creatorName, email: process.env.SENDGRID_FROM_EMAIL || "invoices@tryverza.com" },
                  subject: `Payment Reminder: Milestone for ${contract.projectName || contract.brand}`,
                  text: `A payment of $${milestone.amount} for milestone "${milestone.description}" is due on ${dueDateFormatted}. Pay here: ${paymentLink}`,
                  html: htmlContent,
                  customArgs: { contractId: doc.id, milestoneId: milestone.id },
              };
              
              await sgMail.send(msg);

              const updatedMilestones = contract.milestones.map(m => 
                m.id === milestone.id ? { ...m, lastReminderSentAt: admin.firestore.Timestamp.now() } : m
              );
              
              await doc.ref.update({
                milestones: updatedMilestones,
                invoiceHistory: admin.firestore.FieldValue.arrayUnion({
                  timestamp: admin.firestore.Timestamp.now(),
                  action: `Upcoming Reminder Sent for Milestone: ${milestone.description}`,
                  details: `To: ${contract.clientEmail}`,
                }),
              });

              logger.info(`Sent upcoming payment reminder for contract ${doc.id}, milestone ${milestone.id}`);
            }
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
      await sendEmailSequence(user.email, user.displayName || "Creator", currentStep);

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
