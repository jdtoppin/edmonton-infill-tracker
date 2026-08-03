-- Keep recent dashboard signals date-ordered without scanning every project event.
CREATE INDEX "ProjectEvent_eventDate_id_idx"
ON "ProjectEvent"("eventDate" DESC, "id" ASC);
