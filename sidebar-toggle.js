// Sidebar toggle enhancement - adds re-open button via CSS pseudo-element click
(function() {
    const sidebar = document.getElementById('sidebar');
    const body = document.body;
    
    // When sidebar is collapsed, clicking the pseudo-element ::before should re-open it
    // Since we can't directly click pseudo-elements, we'll add a click listener to the body
    // and check if click is on the left edge where the button appears
    
    body.addEventListener('click', function(e) {
        // Check if sidebar is collapsed and click is near the left edge (hamburger button area)
        if (body.classList.contains('sidebar-collapsed') && e.clientX < 70 && e.clientY < 70) {
            sidebar.classList.remove('collapsed');
            body.classList.remove('sidebar-collapsed');
        }
    });
    
    // Listen for sidebar collapse/expand to update body class
    const observer = new MutationObserver(function() {
        if (sidebar.classList.contains('collapsed')) {
            body.classList.add('sidebar-collapsed');
        } else {
            body.classList.remove('sidebar-collapsed');
        }
    });
    
    observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
})();
