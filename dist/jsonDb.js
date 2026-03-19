import fs from 'fs/promises';
import path from 'path';
const DB_PATH = process.env.DB_PATH || path.resolve('db.json');
class JsonDB {
    data = { users: [], groups: [], chores: [], debts: [] };
    async init() {
        try {
            const content = await fs.readFile(DB_PATH, 'utf-8');
            this.data = JSON.parse(content);
            this.data.groups = this.data.groups.map(g => ({
                ...g,
                penaltyDays: g.penaltyDays ?? 0,
                members: g.members.map(m => ({
                    ...m,
                    penaltyDays: m.penaltyDays ?? 0
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
        await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2));
    }
    getUsers() { return this.data.users; }
    getGroups() { return this.data.groups; }
    getChores() { return this.data.chores; }
    getDebts() { return this.data.debts; }
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
            group.members.push({ userId, order: group.members.length, penaltyDays: 0 });
            await this.save();
            return true;
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
    async decrementPenaltyOrMoveTurn(groupId) {
        const group = this.data.groups.find(g => g.id === groupId);
        if (group) {
            // Check current person for penalties
            const assignments = this.getGroupActiveAssignments(group);
            const currentPersonId = assignments.length > 0 ? assignments[0].userId : null;
            const member = group.members.find(m => m.userId === currentPersonId);
            if (member && member.penaltyDays > 0) {
                member.penaltyDays -= 1;
            }
            else {
                group.currentTurn += 1;
            }
            await this.save();
        }
    }
    // Private helper for turn logic consistency
    getGroupActiveAssignments(group) {
        // Note: We need getActiveTasks here too but it's in bot.ts
        // For simplicity let's just use the first member by current turn
        if (group.members.length === 0)
            return [];
        const index = group.currentTurn % group.members.length;
        return [group.members[index]];
    }
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
