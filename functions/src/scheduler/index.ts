
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import type {UserProfileFirestoreData, Contract} from "./../types";
import {sendEmailSequence} from "../notifications";
import * as params from "../config/params";

// Send reminders for overdue invoices
export const sendOverdueInvoiceReminders = onSchedule("every 24 hours", async () => {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set. Skipping overdue reminders.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const activeStatuses = ["pending", "invoiced", "partially_paid", "overdue", "sent", "viewed"];
    const contractsSnapshot = await db
      .collection("contracts")
      .where("status", "in", activeStatuses)
      .get();

    logger.info(`Found ${contractsSnapshot.docs.length} active contracts to check for overdue milestones.`);

    const emailLogoHeader = `
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="32" height="24" 
          style="vertical-align: middle; margin-right: 8px;">
        <span style="font-weight: bold; font-size: 24px; color: #6B37FF; 
          vertical-align: middle; font-family: sans-serif;">Verza</span>
      </div>
    `;

    for (const doc of contractsSnapshot.docs) {
      const contract = doc.data() as Contract;
      if (!contract.milestones || contract.milestones.length === 0) continue;

      for (const milestone of contract.milestones) {
        const milestoneDueDate = new Date(milestone.dueDate + "T00:00:00");
        const lastReminder = milestone.lastReminderSentAt?.toDate();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const isOverdue = milestoneDueDate < todayMidnight;
        const needsReminder = !lastReminder || lastReminder < threeDaysAgo;

        if (milestone.status !== "paid" && isOverdue && needsReminder) {
          // This milestone is overdue and needs a reminder
          logger.info(`Found overdue milestone for contract ${doc.id}. Milestone: "${milestone.description}"`);

          if (!contract.clientEmail) {
            logger.warn(`No client email for overdue milestone on contract ${doc.id}`);
            continue;
          }

          const creatorDoc = await db.collection("users").doc(contract.userId).get();
          const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
          const creatorName = creator?.displayName || "The Creator";
          const appUrl = params.APP_URL.value();
          const paymentLink = `${appUrl}/pay/contract/${doc.id}?milestoneId=${milestone.id}`;

          const htmlContent = `
            <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
            <body style="background-color: #f4f4f7; padding: 20px; font-family: sans-serif;">
              <div style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #e2e2e2; 
                border-radius: 12px; overflow: hidden; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                ${emailLogoHeader}
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="margin: 0; color: #EF4444; font-size: 24px;">Payment Overdue</h1>
                </div>
                <div style="color: #555; line-height: 1.6;">
                  <p>Hello,</p>
                  <p>This is a reminder that the payment of <strong>$${milestone.amount.toLocaleString()}</strong>
                  for the milestone <strong>'${milestone.description}'</strong> on project
                  <strong>'${contract.projectName || contract.brand}'</strong> is now overdue.</p>
                  <p>To keep things on track, please process your payment at your earliest convenience.
                  You can pay securely via the link below:</p>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${paymentLink}" style="background-color: #EF4444; color: #ffffff; text-decoration: none; 
                    padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: bold;">Pay Now</a>
                  </div>
                  <p>Thank you,<br/><strong>The Verza Team on behalf of ${creatorName}</strong></p>
                </div>
              </div>
            </body></html>
          `;

          const msg = {
            to: contract.clientEmail,
            from: {name: creatorName, email: params.SENDGRID_FROM_EMAIL.value()},
            subject: `Payment Reminder - Milestone for ${contract.projectName || contract.brand} is Overdue`,
            text: `This is a reminder that your payment of $${milestone.amount} for
            milestone "${milestone.description}" is overdue. Pay now: ${paymentLink}`,
            html: htmlContent,
            customArgs: {contractId: doc.id, milestoneId: milestone.id},
          };

          await sgMail.send(msg);

          const updatedMilestones = contract.milestones.map((m) =>
            m.id === milestone.id ? {...m, lastReminderSentAt: admin.firestore.Timestamp.now()} : m
          );

          await doc.ref.update({
            milestones: updatedMilestones,
            invoiceStatus: "overdue",
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
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, cannot send reminder emails.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysFromNow = new Date(todayMidnight.getTime() + 7 * 24 * 60 * 60 * 1000);

    const activeStatuses = ["pending", "invoiced", "partially_paid", "sent", "viewed"];
    const contractsSnapshot = await db
      .collection("contracts")
      .where("status", "in", activeStatuses)
      .get();

    logger.info(`Found ${contractsSnapshot.docs.length} active contracts to check for upcoming milestones.`);

    const emailLogoHeader = `
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="32" height="24" 
          style="vertical-align: middle; margin-right: 8px;">
        <span style="font-weight: bold; font-size: 24px; color: #6B37FF; 
          vertical-align: middle; font-family: sans-serif;">Verza</span>
      </div>
    `;

    for (const doc of contractsSnapshot.docs) {
      const contract = doc.data() as Contract;
      if (!contract.milestones || contract.milestones.length === 0) continue;

      for (const milestone of contract.milestones) {
        const milestoneDueDate = new Date(milestone.dueDate + "T00:00:00");
        const lastReminder = milestone.lastReminderSentAt?.toDate();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const isSoon = milestoneDueDate >= todayMidnight && milestoneDueDate <= sevenDaysFromNow;
        const needsReminder = !lastReminder || lastReminder < threeDaysAgo;

        if (milestone.status === "pending" && isSoon && needsReminder) {
          logger.info(`Found upcoming milestone for contract ${doc.id}. Milestone: "${milestone.description}"`);

          if (!contract.clientEmail) {
            logger.warn(`No client email for upcoming milestone reminder on contract ${doc.id}`);
            continue;
          }

          const creatorDoc = await db.collection("users").doc(contract.userId).get();
          const creator = creatorDoc.data() as UserProfileFirestoreData | undefined;
          const creatorName = creator?.displayName || "The Creator";
          const dueDateFormatted = new Date(milestone.dueDate + "T00:00:00").toLocaleDateString("en-US",
            {year: "numeric", month: "long", day: "numeric"});
          const appUrl = params.APP_URL.value();
          const paymentLink = `${appUrl}/pay/contract/${doc.id}?milestoneId=${milestone.id}`;

          const htmlContent = `
            <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
            <body style="background-color: #f4f4f7; padding: 20px; font-family: sans-serif;">
              <div style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #e2e2e2; 
                border-radius: 12px; overflow: hidden; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                ${emailLogoHeader}
                <div style="text-align: center; margin-bottom: 20px;">
                  <h2 style="color: #333; margin: 0; font-size: 20px;">Upcoming Payment Reminder</h2>
                </div>
                <div style="color: #555; line-height: 1.6;">
                  <p>Hello,</p>
                  <p>This is a friendly reminder that a payment of <strong>$${milestone.amount.toLocaleString()}</strong>
                  for milestone "<strong>${milestone.description}</strong>" is due on <strong>${dueDateFormatted}</strong>.</p>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${paymentLink}" style="background-color: #6B37FF; color: #ffffff; text-decoration: none; 
                    padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: bold;">Pay Now</a>
                  </div>
                  <p>Thank you,<br/><strong>${creatorName}</strong></p>
                </div>
              </div>
            </body></html>
          `;

          const msg = {
            to: contract.clientEmail,
            from: {name: creatorName, email: params.SENDGRID_FROM_EMAIL.value()},
            subject: `Payment Reminder: Milestone for ${contract.projectName || contract.brand}`,
            text: `A payment of $${milestone.amount} for milestone "${milestone.description}"
            is due on ${dueDateFormatted}. Pay here: ${paymentLink}`,
            html: htmlContent,
            customArgs: {contractId: doc.id, milestoneId: milestone.id},
          };

          await sgMail.send(msg);

          const updatedMilestones = contract.milestones.map((m) =>
            m.id === milestone.id ? {...m, lastReminderSentAt: admin.firestore.Timestamp.now()} : m
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
