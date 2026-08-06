// Deprecated compatibility surface. New planning code must produce ExecutionPlan directly.
export {
  TASK_PLAN_SCHEMA_VERSION,
  planTask,
  validateTaskPlan
} from "../legacy/task-planner.js";
