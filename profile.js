import { state } from './script.js';
import { ui } from './ui.js';

export function openProfileModal() {
    if (!state.currentUser) return;
    renderProfileStats(state.currentUser);
    ui.profileModal.classList.remove('hidden');
}

export function renderProfileStats(userData) {
    const stats = userData.stats || {
        gamesPlayed: 0,
        gamesWon: 0,
        totalScore: 0,
        modesPlayed: {}
    };

    const winRate = stats.gamesPlayed > 0 
        ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) 
        : 0;

    const avgScore = stats.gamesPlayed > 0 
        ? Math.round(stats.totalScore / stats.gamesPlayed) 
        : 0;

    let favoriteMode = 'None';
    if (stats.modesPlayed && Object.keys(stats.modesPlayed).length > 0) {
        favoriteMode = Object.keys(stats.modesPlayed).reduce((a, b) => stats.modesPlayed[a] > stats.modesPlayed[b] ? a : b);
        favoriteMode = favoriteMode.charAt(0).toUpperCase() + favoriteMode.slice(1);
    }

    ui.profileModal.innerHTML = `
        <div class="modal-content bg-gray-900 w-full max-w-2xl text-left relative border border-gray-700 shadow-2xl overflow-hidden">
            <div class="absolute top-0 left-0 w-full h-32 bg-gradient-to-r from-purple-600 to-blue-600 opacity-20"></div>
            
            <button data-action="close" class="absolute top-4 right-4 text-gray-400 hover:text-white text-3xl font-bold z-10 transition transform hover:rotate-90">&times;</button>
            
            <div class="relative z-10 flex flex-col items-center pt-8 pb-6">
                <div class="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-4xl font-bold shadow-lg mb-4 border-4 border-gray-800">
                    ${userData.displayName ? userData.displayName.charAt(0).toUpperCase() : '?'}
                </div>
                <h2 class="text-3xl font-bold text-white tracking-wide">${userData.displayName}</h2>
                <p class="text-gray-400 text-sm mt-1">Bingo Veteran</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 pt-0 relative z-10">
                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-blue-400">🎲</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Games Played</p>
                        <p class="text-3xl font-bold text-white">${stats.gamesPlayed}</p>
                    </div>
                </div>

                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-green-400">🏆</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Games Won</p>
                        <p class="text-3xl font-bold text-white">${stats.gamesWon}</p>
                    </div>
                </div>

                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-yellow-400">⚡</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Win Rate</p>
                        <p class="text-3xl font-bold text-white">${winRate}%</p>
                    </div>
                </div>

                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-purple-400">❤️</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Favorite Mode</p>
                        <p class="text-3xl font-bold text-white">${favoriteMode}</p>
                    </div>
                </div>

                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-pink-400">🌟</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Total Score</p>
                        <p class="text-3xl font-bold text-white">${stats.totalScore.toLocaleString()}</p>
                    </div>
                </div>

                <div class="bg-gray-800 rounded-xl p-5 flex items-center shadow-md transform transition hover:-translate-y-1 hover:shadow-lg border border-gray-700">
                    <div class="text-4xl mr-4 text-cyan-400">📈</div>
                    <div>
                        <p class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Avg Score</p>
                        <p class="text-3xl font-bold text-white">${avgScore.toLocaleString()}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}
