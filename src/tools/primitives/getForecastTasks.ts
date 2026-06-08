import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { logger } from '../../utils/logger.js';
import { formatDateSafe, parseLocalDate, classifyForecastDate } from '../../utils/dateUtils.js';

const log = logger.child('getForecastTasks');

export interface GetForecastTasksOptions {
  days?: number;
  hideCompleted?: boolean;
  includeDeferredOnly?: boolean;
}

export async function getForecastTasks(options: GetForecastTasksOptions = {}): Promise<string> {
  const { days = 7, hideCompleted = true, includeDeferredOnly = false } = options;
  
  try {
    // Execute the forecast tasks script
    const result = await executeOmniFocusScript('@forecastTasks.js', { 
      days: days,
      hideCompleted: hideCompleted,
      includeDeferredOnly: includeDeferredOnly
    });
    
    if (typeof result === 'string') {
      return result;
    }
    
    // If result is an object, format it
    if (result && typeof result === 'object') {
      const data = result as any;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Format the forecast tasks
      let output = `# 📅 FORECAST - Next ${days} days\n\n`;
      
      if (data.tasksByDate && typeof data.tasksByDate === 'object') {
        const dates = Object.keys(data.tasksByDate).sort();
        
        if (dates.length === 0) {
          output += "🎉 No tasks due in the forecast period - enjoy the calm!\n";
        } else {
          const now = new Date();
          let totalTasks = 0;

          dates.forEach(dateStr => {
            const tasks = data.tasksByDate[dateStr];
            if (!tasks || tasks.length === 0) return;

            const taskDate = parseLocalDate(dateStr);
            if (!taskDate) return; // skip unparseable forecast keys
            const category = classifyForecastDate(taskDate, now);

            let dateHeader = '';
            if (category === 'OVERDUE') {
              dateHeader = `## ⚠️ OVERDUE - ${taskDate.toLocaleDateString()}`;
            } else if (category === 'TODAY') {
              dateHeader = `## 🔥 TODAY - ${taskDate.toLocaleDateString()}`;
            } else if (category === 'TOMORROW') {
              dateHeader = `## ⏰ TOMORROW - ${taskDate.toLocaleDateString()}`;
            } else {
              const dayOfWeek = taskDate.toLocaleDateString('en-US', { weekday: 'long' });
              dateHeader = `## 📅 ${dayOfWeek} - ${taskDate.toLocaleDateString()}`;
            }

            output += `${dateHeader}\n`;
            
            tasks.forEach((task: any) => {
              const flagSymbol = task.flagged ? '🚩 ' : '';
              const projectStr = task.projectName ? ` (${task.projectName})` : ' (Inbox)';
              const statusStr = task.taskStatus !== 'Available' ? ` [${task.taskStatus}]` : '';
              const estimateStr = task.estimatedMinutes ? ` ⏱${task.estimatedMinutes}m` : '';
              const typeIndicator = task.isDue ? '📅' : '🚀'; // Due vs Deferred
              const createdStr = task.createdDate ? ` (created: ${formatDateSafe(task.createdDate)})` : '';

              output += `• ${typeIndicator} ${flagSymbol}${task.name}${projectStr}${statusStr}${estimateStr} [ID: ${task.id}]${createdStr}\n`;
              
              if (task.note && task.note.trim()) {
                output += `  📝 ${task.note.trim()}\n`;
              }
            });

            totalTasks += tasks.length; // count only dates we actually rendered
            output += '\n';
          });

          // Summary
          output += `📊 **Summary**: ${totalTasks} task${totalTasks === 1 ? '' : 's'} in forecast\n`;
        }
      } else {
        output += "No forecast data available\n";
      }
      
      return output;
    }
    
    log.error('Unexpected result format', { resultType: typeof result, result });
    throw new Error('Unexpected result format from OmniFocus');

  } catch (error) {
    log.error('Error in getForecastTasks', { error: error instanceof Error ? error.message : String(error) });
    throw new Error(`Failed to get forecast tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}