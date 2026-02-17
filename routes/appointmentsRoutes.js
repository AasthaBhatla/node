const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requirePartner = require("../middlewares/requirePartner");

const appointmentsController = require("../controllers/appointmentsController");

/**
 * Partner:
 * - POST /appointments/partner/me/settings
 * - POST /appointments/partner/me/weekly-availability
 * - POST /appointments/partner/me/time-off
 * - GET  /appointments/partner/me/appointments
 * - POST /appointments/:id/respond
 * - POST /appointments/:id/cancel-by-partner
 *
 * Client:
 * - GET  /appointments/partners/:partnerId/slots?date=YYYY-MM-DD
 * - POST /appointments
 * - GET  /appointments/me
 * - POST /appointments/:id/cancel
 */

router.post(
  "/partner/me/settings",
  authMiddleware,
  requirePartner(),
  appointmentsController.upsertPartnerSettings,
);

router.post(
  "/partner/me/weekly-availability",
  authMiddleware,
  requirePartner(),
  appointmentsController.replaceWeeklyAvailability,
);

router.post(
  "/partner/me/time-off",
  authMiddleware,
  requirePartner(),
  appointmentsController.addTimeOff,
);

router.get(
  "/partner/me/appointments",
  authMiddleware,
  requirePartner(),
  appointmentsController.listPartnerAppointments,
);

router.get(
  "/partners/:partnerId/slots",
  authMiddleware,
  appointmentsController.getPartnerSlotsByDate,
);

router.get(
  "/partners/:partnerId/available-days",
  authMiddleware,
  appointmentsController.getPartnerAvailableDaysInMonth,
);

router.post("/", authMiddleware, appointmentsController.createAppointment);

router.get("/me", authMiddleware, appointmentsController.listMyAppointments);

router.post(
  "/:id/cancel",
  authMiddleware,
  appointmentsController.cancelAsClient,
);

router.post(
  "/:id/respond",
  authMiddleware,
  requirePartner(),
  appointmentsController.respondAsPartner,
);

router.post(
  "/:id/cancel-by-partner",
  authMiddleware,
  requirePartner(),
  appointmentsController.cancelAsPartner,
);

// routes/appointmentsRoutes.js (ADD these routes)

// Partner reads
router.get(
  "/partner/me/settings",
  authMiddleware,
  requirePartner(),
  appointmentsController.getPartnerSettings,
);

router.get(
  "/partner/me/weekly-availability",
  authMiddleware,
  requirePartner(),
  appointmentsController.getWeeklyAvailability,
);

router.get(
  "/partner/me/time-off",
  authMiddleware,
  requirePartner(),
  appointmentsController.listTimeOff,
);

router.get(
  "/partner/me/slots",
  authMiddleware,
  requirePartner(),
  appointmentsController.getMySlotsByDate,
);

router.delete(
  "/partner/me/time-off/:id",
  authMiddleware,
  requirePartner(),
  appointmentsController.deleteTimeOff,
);

router.post(
  "/partner/me/time-off/:id",
  authMiddleware,
  requirePartner(),
  appointmentsController.updateTimeOff,
);

module.exports = router;
