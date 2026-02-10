// Move mocks to top before any requires just to be safe (though Jest hoists)
const { createGSTIN } = require('./gstinController');

// Mock external dependencies
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
jest.mock('../../../shared/src/utils/responseHandler', () => ({
    successResponse: jest.fn((res, data, msg) => res.status(200).json({ data, msg })),
    errorResponse: jest.fn((res, err) => res.status(500).json({ error: err.message }))
}));

// Mock the model to prevent DB connection
// We use a virtual mock to ensure the real file is never loaded
jest.mock('../models/gstin', () => ({
    findByGSTIN: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn()
}));

const GSTIN = require('../models/gstin');

describe('GSTIN Controller', () => {
    let req, res;

    beforeEach(() => {
        req = {
            body: {
                gstin: '27ABCDE1234F1Z5',
                legal_name: 'Acme Corp',
                state_code: '27'
            },
            headers: {
                'x-workspace-id': 'workspace-123'
            }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        jest.clearAllMocks();
    });

    it('should create a GSTIN successfully', async () => {
        GSTIN.findByGSTIN.mockResolvedValue(null);
        GSTIN.create.mockResolvedValue({
            id: 'mock-uuid',
            gstin: '27ABCDE1234F1Z5',
            legal_name: 'Acme Corp'
        });

        await createGSTIN(req, res);

        expect(GSTIN.create).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            msg: 'GSTIN registered successfully'
        }));
    });

    it('should return 400 if workspace ID is missing', async () => {
        req.headers['x-workspace-id'] = undefined;
        await createGSTIN(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'X-Workspace-ID header is required' });
    });
});
