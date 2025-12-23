// Sidebar toggle enhancement - handles menu button clicks
(function() {
    // Check if we're using the new Tivimate UI
    const menuBtn = document.getElementById('menuBtn');
    const sidebarLeft = document.getElementById('sidebarLeft');
    const sidebarClose = document.getElementById('sidebarClose');
    
    // If using new Tivimate UI, setup menu toggle
    if (menuBtn && sidebarLeft && sidebarClose) {
        menuBtn.addEventListener('click', function() {
            sidebarLeft.classList.toggle('active');
        });
        
        sidebarClose.addEventListener('click', function() {
            sidebarLeft.classList.remove('active');
        });
        
        return; // Exit - using new UI
    }
    
    // Fallback for old UI
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    const body = document.body;
    
    body.addEventListener('click', function(e) {
        if (body.classList.contains('sidebar-collapsed') && e.clientX < 70 && e.clientY < 70) {
            sidebar.classList.remove('collapsed');
            body.classList.remove('sidebar-collapsed');
        }
    });
    
    const observer = new MutationObserver(function() {
        if (sidebar && sidebar.classList.contains('collapsed')) {
            body.classList.add('sidebar-collapsed');
        } else {
            body.classList.remove('sidebar-collapsed');
        }
    });
    
    if (sidebar) {
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
})();
