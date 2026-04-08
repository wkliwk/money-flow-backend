process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/utils/alerts', () => ({
  processPendingAlerts: jest.fn(),
}));

import { processPendingAlerts } from '../src/utils/alerts';
import { processAlertsJob } from '../src/jobs/processAlerts';

const mockedProcessPendingAlerts = processPendingAlerts as jest.MockedFunction<
  typeof processPendingAlerts
>;

describe('processAlertsJob error handling', () => {
  it('logs error when processPendingAlerts throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockedProcessPendingAlerts.mockRejectedValueOnce(new Error('job error'));

    await processAlertsJob();

    expect(errorSpy).toHaveBeenCalledWith(
      '[AlertJob] Error processing alerts:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
