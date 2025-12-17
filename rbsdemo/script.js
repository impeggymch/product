document.addEventListener('DOMContentLoaded', () => {
    // 1. 導覽列捲動變色
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // 2. [修復] FAQ 開合功能
    const accordions = document.querySelectorAll('.accordion-header');
    accordions.forEach(acc => {
        acc.addEventListener('click', () => {
            acc.classList.toggle('active'); // 切換箭頭旋轉與顏色
            const panel = acc.nextElementSibling; // 取得下方的 content 區塊
            
            // 透過 max-height 控制開合動畫
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            }
        });
    });

    // 3. 手機版選單 (RWD)
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            // 切換選單顯示狀態
            if (navLinks.style.display === 'flex') {
                navLinks.style.display = 'none';
            } else {
                navLinks.style.display = 'flex';
                navLinks.style.flexDirection = 'column';
                navLinks.style.position = 'absolute';
                navLinks.style.top = '60px';
                navLinks.style.left = '0';
                navLinks.style.width = '100%';
                navLinks.style.background = '#fff';
                navLinks.style.padding = '20px';
                const links = navLinks.querySelectorAll('a');
                links.forEach(link => link.style.color = '#333');
            }
        });
    }

    // 4. [新增] 側邊導覽點 Scroll Spy (捲動監聽)
    const sections = document.querySelectorAll('header, section'); 
    const navDots = document.querySelectorAll('.nav-dot');

    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.3 
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                navDots.forEach(dot => dot.classList.remove('active'));
                const id = entry.target.getAttribute('id');
                if (id) {
                    const activeDot = document.querySelector(`.nav-dot[data-target="${id}"]`);
                    if (activeDot) {
                        activeDot.classList.add('active');
                    }
                }
            }
        });
    }, observerOptions);

    sections.forEach(section => {
        observer.observe(section);
    });

    // 5. [新增] 預約流程步驟自動輪播
    const processSteps = document.querySelectorAll('.process-item');
    const processSection = document.querySelector('#process'); 

    if (processSteps.length > 0) {
        let currentStepIndex = 0;
        let stepInterval;

        const animateSteps = () => {
            processSteps.forEach(step => step.classList.remove('active-step'));
            processSteps[currentStepIndex].classList.add('active-step');
            currentStepIndex = (currentStepIndex + 1) % processSteps.length;
        };

        const startCarousel = () => {
            if (stepInterval) clearInterval(stepInterval);
            stepInterval = setInterval(animateSteps, 2000); // 每2秒換下一個
        };

        const stopCarousel = () => {
            if (stepInterval) clearInterval(stepInterval);
        };

        // 滑鼠移入暫停，移出繼續
        if (processSection) {
            processSection.addEventListener('mouseenter', stopCarousel);
            processSection.addEventListener('mouseleave', startCarousel);
        }

        // 初始化
        animateSteps(); 
        startCarousel();
    }
});