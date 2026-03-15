import { VoidedE2EEClient } from '../index';
import { CLIENT_MAX_UPLOAD_BYTES, VOI_FILE_TOO_LARGE } from '../limits';

describe('Client-side 32 GiB limit enforcement across public API', () => {
    it('encrypt rejects when originalSizeBytes > cap', async () => {
        const client = new VoidedE2EEClient();
        const data = 'x'.repeat(1024);
        const over = CLIENT_MAX_UPLOAD_BYTES + 1;
        await expect(client.encrypt(data, { originalSizeBytes: over })).rejects.toMatchObject({ code: VOI_FILE_TOO_LARGE });
    });

    it('encrypt allows exactly at cap and below', async () => {
        const client = new VoidedE2EEClient();
        const data = 'x'.repeat(1024);
        const under = CLIENT_MAX_UPLOAD_BYTES - 1;
        const exact = CLIENT_MAX_UPLOAD_BYTES;

        const result1 = await client.encrypt(data, { originalSizeBytes: under });
        expect(result1).toBeTruthy();

        const result2 = await client.encrypt(data, { originalSizeBytes: exact });
        expect(result2).toBeTruthy();
    });

    it('resume token size > cap is rejected', async () => {
        const client = new VoidedE2EEClient();
        const data = 'x'.repeat(1024);
        const over = CLIENT_MAX_UPLOAD_BYTES + 1;
        await expect(client.encrypt(data, { resumeTokenOriginalSize: over })).rejects.toMatchObject({ code: VOI_FILE_TOO_LARGE });
    });
});


