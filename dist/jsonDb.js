import fs from 'fs/promises';
import path from 'path';
const DB_PATH = process.env.DB_PATH || path.resolve('db.json');
const TASKS_CONFIG = [
    { id: 'axlat', label: "🗑 Axlat to'kish", frequency: 1 },
    { id: 'supurish', label: "🧹 Supurish", frequency: 2 },
    { id: 'vanna', label: "🧼 Vanna tozalash", frequency: 7 }
];
class JsonDB {
    data = { users: [], groups: [], chores: [], debts: [] };
    saveQueue = Promise.resolve();
    async init() {
        try {
            const content = await fs.readFile(DB_PATH, 'utf-8');
            this.data = JSON.parse(content);
            this.data.groups = this.data.groups.map(g => ({
                ...g,
                penaltyDays: g.penaltyDays ?? 0,
                members: g.members.map(m => ({
                    ...m,
                    penaltyDays: m.penaltyDays ?? 0,
                    taskDebts: m.taskDebts ?? { 'axlat': 0, 'supurish': 0, 'vanna': 0 }
                }))
            }));
            if (!this.data.debts)
                this.data.debts = [];
            if (this.data.chores) {
                this.data.chores = this.data.chores.map(c => ({
                    ...c,
                    taskType: c.taskType || 'umumiy'
                }));
            }
        }
        catch (e) {
            console.log("Yangi db.json fayli yaratilmoqda...");
            await this.save();
        }
    }
    async save() {
        this.saveQueue = this.saveQueue.then(async () => {
            try {
                await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2));
            }
            catch (err) {
                console.error("Faylga saqlashda xatolik:", err);
            }
        });
        return this.saveQueue;
    }
    getUsers() { return this.data.users; }
    getGroups() { return this.data.groups; }
    getChores() { return this.data.chores; }
    getDebts() { return this.data.debts; }
    getActiveTasks(date) {
        const tashkentOffset = 5 * 60;
        const localTime = new Date(date.getTime() + (date.getTimezoneOffset() + tashkentOffset) * 60000);
        const daysSinceEpoch = Math.floor(localTime.getTime() / (1000 * 60 * 60 * 24));
        const dayOfWeek = localTime.getDay(); // 0 is Sunday
        const active = [];
        active.push(TASKS_CONFIG[0]);
        if (daysSinceEpoch % 2 === 0)
            active.push(TASKS_CONFIG[1]);
        if (dayOfWeek === 0)
            active.push(TASKS_CONFIG[2]);
        return active;
    }
    getTaskAssignments(groupId, date = new Date()) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (!group || group.members.length === 0)
            return [];
        const activeTasks = this.getActiveTasks(date);
        const N = group.members.length;
        // 1. Normal rotation for today
        const assignments = activeTasks.map((task) => {
            const taskOriginalIndex = TASKS_CONFIG.findIndex(t => t.id === task.id);
            const index = (group.currentTurn + taskOriginalIndex) % N;
            const member = group.members[index];
            const user = this.data.users.find(u => u.id === member.userId);
            return { task, user, userId: member.userId, isDebt: false };
        });
        // 2. Add anyone who has outstanding debts for ANY task (not just active today)
        group.members.forEach(m => {
            for (const taskId in m.taskDebts) {
                if (m.taskDebts[taskId] > 0) {
                    // If this member is already assigned this task today, skip adding as extra
                    if (assignments.some(a => a.userId === m.userId && a.task.id === taskId))
                        continue;
                    const task = TASKS_CONFIG.find(t => t.id === taskId);
                    if (task) {
                        const user = this.data.users.find(u => u.id === m.userId);
                        assignments.push({ task, user, userId: m.userId, isDebt: true });
                    }
                }
            }
        });
        return assignments;
    }
    async upsertUser(user) {
        const index = this.data.users.findIndex(u => u.id === user.id);
        if (index > -1) {
            this.data.users[index] = user;
        }
        else {
            this.data.users.push(user);
        }
        await this.save();
    }
    async upsertGroup(groupId) {
        if (!this.data.groups.find(g => g.id === groupId)) {
            this.data.groups.push({ id: groupId, currentTurn: 0, reminderHour: 9, members: [], penaltyDays: 0 });
            await this.save();
        }
    }
    async addMember(groupId, userId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group && !group.members.find(m => m.userId === userId)) {
            group.members.push({
                userId,
                order: group.members.length,
                penaltyDays: 0,
                taskDebts: { 'axlat': 0, 'supurish': 0, 'vanna': 0 }
            });
            await this.save();
            return true;
        }
        return false;
    }
    async removeMember(groupId, userId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            const index = group.members.findIndex(m => m.userId === userId);
            if (index > -1) {
                group.members.splice(index, 1);
                // Reorder remaining members
                group.members = group.members.map((m, i) => ({ ...m, order: i }));
                await this.save();
                return true;
            }
        }
        return false;
    }
    async createChore(groupId, userId, photoId, taskType) {
        const chore = {
            id: Date.now(),
            groupId,
            userId,
            photoId,
            taskType,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        this.data.chores.push(chore);
        await this.save();
        return chore;
    }
    async updateChoreStatus(choreId, status) {
        const chore = this.data.chores.find(c => c.id === choreId);
        if (chore) {
            chore.status = status;
            await this.save();
            return chore;
        }
        return null;
    }
    async addPenalty(groupId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            group.penaltyDays += 1;
            await this.save();
        }
    }
    async addMemberPenalty(groupId, userId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            const member = group.members.find(m => m.userId === userId);
            if (member) {
                member.penaltyDays = (member.penaltyDays || 0) + 1;
                await this.save();
            }
        }
    }
    async addMemberTaskPenalty(groupId, userId, taskId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            const member = group.members.find(m => m.userId === userId);
            if (member) {
                if (!member.taskDebts)
                    member.taskDebts = { 'axlat': 0, 'supurish': 0, 'vanna': 0 };
                member.taskDebts[taskId] = (member.taskDebts[taskId] || 0) + 1;
                await this.save();
            }
        }
    }
    async clearMemberTaskDebt(groupId, userId, taskId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            const member = group.members.find(m => m.userId === userId);
            if (member && member.taskDebts && member.taskDebts[taskId] > 0) {
                member.taskDebts[taskId] -= 1;
                await this.save();
                return true; // Used a debt
            }
        }
        return false; // Was a normal daily task
    }
    async decrementPenaltyOrMoveTurn(groupId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            // Find the member who is at the current rotation (usually for daily 'axlat' task)
            const index = group.currentTurn % group.members.length;
            const member = group.members[index];
            // Note: We only move turn if the member responsible for the rotation task is 'clean'
            // This is optional but ensures rotation logic stays paused if needed.
            // However, the user wants the debt to accumulate.
            // Let's just always move turn at midnight, and debts stay with people.
            group.currentTurn += 1;
            await this.save();
        }
    }
    // Remove the previous temporary helper
    async updateMembersOrder(groupId, members) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            group.members = members.map((m, i) => ({ ...m, order: i }));
            await this.save();
            return true;
        }
        return false;
    }
    async addDebt(payerId, debtorId, amount, description, groupId) {
        const debt = {
            id: Math.random().toString(36).substr(2, 9),
            payerId,
            debtorId,
            amount,
            description,
            groupId,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        this.data.debts.push(debt);
        await this.save();
        return debt;
    }
    async settleDebt(debtId) {
        const debt = this.data.debts.find(d => d.id === debtId);
        if (debt) {
            debt.status = 'settled';
            await this.save();
            return true;
        }
        return false;
    }
    async partialSettleDebt(debtId, paidAmount) {
        const debt = this.data.debts.find(d => d.id === debtId);
        if (debt) {
            if (paidAmount >= debt.amount) {
                debt.status = 'settled';
            }
            else {
                debt.amount -= paidAmount;
            }
            await this.save();
            return true;
        }
        return false;
    }
}
export const jsonDatabase = new JsonDB();
