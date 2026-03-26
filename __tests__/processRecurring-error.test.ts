process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/utils/recurring', () => ({
  processRecurringExpenses: jest.fn(),
  calculateNextOccurrence: jest.fn(),
  validateRecurringData: jest.fn(),
}));

import { processRecurringExpenses } from '../src/utils/recurring';
import { processRecurringJob } from '../src/jobs/processRecurring';

const mockedProcessRecurringExpenses = processRecurringExpenses as jest.MockedFunction<
  typeof processRecurringExpenses
>;

describe('processRecurringJob error handling', () => {
  it('logs error when processRecurringExpenses throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockedProcessRecurringExpenses.mockRejectedValueOnce(new Error('job error'));

    await processRecurringJob();

    expect(errorSpy).toHaveBeenCalledWith(
      '[RecurringJob] Error processing recurring expenses:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
