import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import './index.css';

function TiltCard({ children, className, id, style = {}, disabled = false }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 20 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 20 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["5deg", "-5deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-5deg", "5deg"]);

  const handleMouseMove = (e) => {
    if (!ref.current || disabled) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    x.set(mouseX / width - 0.5);
    y.set(mouseY / height - 0.5);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      id={id}
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ 
        ...style, 
        rotateX: disabled ? 0 : rotateX, 
        rotateY: disabled ? 0 : rotateY, 
        perspective: 1200, 
        transformStyle: "preserve-3d",
        transition: "transform 0.5s ease-out" 
      }}
      className={className}
    >
      <div style={{ transform: "translateZ(40px)", transformStyle: "preserve-3d", width: '100%', height: '100%' }}>
        {children}
      </div>
    </motion.div>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState(() => {
    if (typeof window === 'undefined') return 'landing';
    const hash = window.location.hash.replace('#', '');
    return ['landing', 'search-view', 'results-view', 'contact-view', 'about-view'].includes(hash) ? hash : 'landing';
  });
  const [prevSection, setPrevSection] = useState(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  const navigateTo = (section) => {
    setPrevSection(activeSection);
    setActiveSection(section);
    window.location.hash = section;
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (['landing', 'search-view', 'results-view', 'contact-view', 'about-view'].includes(hash)) {
        setActiveSection(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/script.js';
    document.body.appendChild(script);

    window.toggleTimeInput = () => {
      const isLater = document.getElementById("schedule-later")?.checked;
      const timeContainer = document.getElementById("time-field-container");
      if (timeContainer) {
        if (isLater) {
            timeContainer.classList.remove("hidden");
        } else {
            timeContainer.classList.add("hidden");
        }
      }
    };

    window.showLanding = () => navigateTo('landing');
    window.showContact = () => navigateTo('contact-view');
    window.showAbout = () => navigateTo('about-view');
    window.searchBus = () => {
       navigateTo('results-view');
    };
    window.openAdmin = () => setIsAdminOpen(true);
    window.closeAdmin = () => setIsAdminOpen(false);
  }, []);

  useEffect(() => {
    // Re-initialize legacy logic when sections change
    const timer = setTimeout(() => {
      if (activeSection === 'search-view' && window.initAutocomplete) {
        window.initAutocomplete();
      }
      if (activeSection === 'results-view' && window.initMap) {
        window.initMap();
        // Force map resize to handle hidden container issues
        if (window.map) {
          setTimeout(() => window.map.invalidateSize(), 400);
        }
      }
    }, 500); // Wait for transition animation to settle
    return () => clearTimeout(timer);
  }, [activeSection]);

  const sectionVariants = {
    enter: (direction) => ({
      y: direction > 0 ? 50 : -50,
      opacity: 0,
      scale: 0.98,
      filter: 'blur(8px)'
    }),
    center: {
      y: 0,
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1]
      }
    },
    exit: (direction) => ({
      y: direction < 0 ? 50 : -50,
      opacity: 0,
      scale: 0.98,
      filter: 'blur(8px)',
      transition: {
        duration: 0.4,
        ease: [0.16, 1, 0.3, 1]
      }
    })
  };

  const getDirection = (target) => {
    const sections = ['landing', 'search-view', 'results-view', 'contact-view', 'about-view'];
    return sections.indexOf(target) - sections.indexOf(activeSection);
  };

  return (
    <div className="w-full min-h-screen relative overflow-hidden bg-[#050507] text-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full p-6 flex justify-between items-center z-[100] backdrop-blur-lg bg-black/20 border-b border-white/5">
        <div className="flex items-center gap-2 cursor-pointer group" onClick={(e) => {
          if (e.detail === 3) setIsAdminOpen(true);
          navigateTo('landing');
        }}>
          <div className="w-10 h-10 rounded-full bg-[hsl(262_83%_58%)] flex items-center justify-center shadow-[0_0_20px_rgba(170,59,255,0.4)] transition-transform group-hover:scale-110">
            <div className="w-4 h-4 bg-white rounded-full"></div>
          </div>
          <span className="font-bold tracking-tight text-white text-xl">Transit AI</span>
        </div>
        <div className="hidden md:flex gap-10 text-sm font-semibold text-white/60">
          <button onClick={() => navigateTo('search-view')} data-active={activeSection === 'search-view'} className="relative hover:text-white transition-all">SEARCH</button>
          <button onClick={() => navigateTo('contact-view')} data-active={activeSection === 'contact-view'} className="relative hover:text-white transition-all">CONTACT</button>
          <button onClick={() => navigateTo('about-view')} data-active={activeSection === 'about-view'} className="relative hover:text-white transition-all">SYSTEM</button>
        </div>
        <button className="px-6 py-2.5 text-sm font-bold text-white bg-white/5 hover:bg-white/10 transition-all rounded-full backdrop-blur-md border border-white/10 hover:border-white/20">
          SIGN UP
        </button>
      </nav>

      <AnimatePresence mode="wait" custom={getDirection(activeSection)}>
        {activeSection === 'landing' && (
          <motion.section 
            key="landing"
            custom={getDirection('landing')}
            variants={sectionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="fixed inset-0 w-full h-screen flex flex-col items-center justify-center text-center px-4 overflow-hidden z-20"
          >
            {/* Cinematic Background Video */}
            <div className="absolute inset-0 w-full h-full object-cover -z-10 bg-black/40 pointer-events-none">
              <video 
                autoPlay 
                muted 
                loop 
                playsInline
                className="w-full h-full object-cover opacity-70"
                src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260308_114720_3dabeb9e-2c39-4907-b747-bc3544e2d5b7.mp4"
              ></video>
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(260_87%_3%/0.9)] via-transparent to-transparent pointer-events-none"></div>
            </div>

            {/* Headline */}
            <motion.h1 
              className="font-black tracking-tighter leading-none"
              style={{ 
                fontSize: 'clamp(80px, 15vw, 220px)', 
                background: 'linear-gradient(to bottom right, #FFFFFF, #4A90E2)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.05em'
              }}
              initial={{ opacity: 0, filter: 'blur(20px)', y: 60 }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            >
              Move
            </motion.h1>

            <motion.p 
              className="text-lg md:text-2xl mt-6 text-white/80 font-medium tracking-wide max-w-2xl leading-relaxed"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
            >
              Experience the next generation of urban mobility powered by state-of-the-art AI.
            </motion.p>

            <motion.div
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
               className="mt-14"
            >
              <button 
                onClick={() => navigateTo('search-view')}
                className="liquid-glass group relative inline-flex items-center gap-3 px-12 py-6 rounded-full text-xl font-bold text-white transition-all duration-500 hover:scale-110 hover:shadow-[0_0_50px_rgba(170,59,255,0.3)] uppercase tracking-[0.2em] border border-white/10"
              >
                <span>Plan Journey</span>
                <span className="text-2xl group-hover:translate-x-2 transition-transform">→</span>
              </button>
            </motion.div>

            {/* Logo Marquee */}
            <div className="absolute bottom-12 w-full overflow-hidden mask-edges opacity-40">
              <div className="flex w-[200%] animate-marquee whitespace-nowrap gap-24 items-center">
                {Array(10).fill(['VORTEX', 'NIMBUS', 'TSRTC', 'OPENAI', 'X-AI', 'HYPERLINK']).flat().map((logo, i) => (
                  <span key={i} className="text-sm font-black tracking-[0.4em] text-white/50">{logo}</span>
                ))}
              </div>
            </div>
          </motion.section>
        )}

        {activeSection === 'search-view' && (
          <motion.section 
            key="search-view"
            custom={getDirection('search-view')}
            variants={sectionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="fixed inset-0 w-full h-screen flex items-center justify-center px-4 z-20 pt-20 bg-[radial-gradient(circle_at_center,rgba(170,59,255,0.05)_0%,transparent_70%)]"
            style={{ perspective: '2000px' }}
          >
              <TiltCard 
                disabled={isInputFocused}
                className="search-panel w-full max-w-2xl border border-white/10 rounded-[2rem] bg-black/40 backdrop-blur-3xl p-10 shadow-[0_0_100px_rgba(0,0,0,0.5)]" 
                style={{ transformStyle: "preserve-3d" }}
              >
                  <h2 className="text-4xl font-bold mb-8 flex items-center gap-4" style={{ transform: "translateZ(50px)" }}>
                    <div className="w-10 h-10 rounded-xl bg-[hsl(262_83%_58%)]/20 flex items-center justify-center border border-[hsl(262_83%_58%)]/30">
                        <span className="text-[hsl(262_83%_58%)] text-xl">⌘</span>
                    </div>
                    <span>Where to?</span>
                  </h2>
                  
                  <div className="space-y-6">
                      <div className="field group" style={{ transform: "translateZ(30px)" }}>
                          <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block ml-1">Starting Point</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">📍</span>
                            <input 
                              type="text" 
                              id="from" 
                              onFocus={() => setIsInputFocused(true)}
                              onBlur={() => setIsInputFocused(false)}
                              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] focus:ring-4 focus:ring-[hsl(262_83%_58%)]/10 transition-all outline-none" 
                              placeholder="Enter origin stop" 
                            />
                          </div>
                      </div>

                      <div className="flex justify-center -my-3 relative z-10" style={{ transform: "translateZ(60px)" }}>
                          <button 
                            className="w-12 h-12 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full flex items-center justify-center transition-all hover:rotate-180 active:scale-90 backdrop-blur-md"
                            onClick={() => window.swapStops && window.swapStops()}
                          >
                            <span className="text-xl">⇅</span>
                          </button>
                      </div>

                      <div className="field group" style={{ transform: "translateZ(30px)" }}>
                          <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block ml-1">Destination</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">🏁</span>
                            <input 
                              type="text" 
                              id="to" 
                              onFocus={() => setIsInputFocused(true)}
                              onBlur={() => setIsInputFocused(false)}
                              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] focus:ring-4 focus:ring-[hsl(262_83%_58%)]/10 transition-all outline-none" 
                              placeholder="Enter destination stop" 
                            />
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4" style={{ transform: "translateZ(20px)" }}>
                          <label className="relative flex flex-col gap-2 p-4 rounded-2xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/10 transition-all group">
                            <input type="radio" id="live-now" name="travelType" value="Live" defaultChecked className="absolute opacity-0" onChange={() => window.toggleTimeInput && window.toggleTimeInput()} />
                            <span className="text-[hsl(262_83%_58%)] font-bold pointer-events-none">LIVE NOW</span>
                            <span className="text-xs text-white/40 pointer-events-none">Immediate departure</span>
                            <div className="absolute inset-0 rounded-2xl border-2 border-[hsl(262_83%_58%)] opacity-0 group-has-[:checked]:opacity-100 transition-opacity pointer-events-none"></div>
                          </label>
                          <label className="relative flex flex-col gap-2 p-4 rounded-2xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/10 transition-all group">
                            <input type="radio" id="schedule-later" name="travelType" value="Later" className="absolute opacity-0" onChange={() => window.toggleTimeInput && window.toggleTimeInput()} />
                            <span className="text-white/80 font-bold pointer-events-none">SCHEDULE</span>
                            <span className="text-xs text-white/40 pointer-events-none">Plan for later</span>
                            <div className="absolute inset-0 rounded-2xl border-2 border-[hsl(262_83%_58%)] opacity-0 group-has-[:checked]:opacity-100 transition-opacity pointer-events-none"></div>
                          </label>
                      </div>

                      <div className="field hidden animate-in slide-in-from-top-4 duration-300" id="time-field-container" style={{ transform: "translateZ(20px)" }}>
                          <input type="time" id="time" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white outline-none focus:border-[hsl(262_83%_58%)] transition-all" />
                      </div>

                      <button 
                        style={{ transform: "translateZ(50px)" }} 
                        className="shimmer-btn w-full mt-6 bg-[hsl(262_83%_58%)] hover:bg-[hsl(262_83%_65%)] text-white font-black py-5 rounded-2xl transition-all shadow-[0_20px_40px_rgba(170,59,255,0.2)] hover:shadow-[0_20px_60px_rgba(170,59,255,0.4)] hover:-translate-y-1 active:translate-y-0 uppercase tracking-widest"
                        onClick={() => { if(window.searchBus) window.searchBus(); }}
                      >
                        Search Intelligence
                      </button>
                  </div>
              </TiltCard>
          </motion.section>
        )}

        {activeSection === 'results-view' && (
          <motion.section 
            key="results-view"
            custom={getDirection('results-view')}
            variants={sectionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="fixed inset-0 w-full h-screen px-4 pb-10 flex flex-col z-20 pt-28"
          >
              <div className="results-layout max-w-[1600px] mx-auto h-full gap-8 flex flex-col md:flex-row w-full">
                  <section id="results-section" className="liquid-glass border border-white/10 rounded-[2.5rem] p-8 md:w-[400px] flex flex-col h-full overflow-hidden shadow-2xl bg-black/40">
                      <div className="results-head flex justify-between items-center mb-8">
                          <div>
                            <h2 className="text-3xl font-bold m-0">Live Fleet</h2>
                            <p className="text-xs text-white/40 font-bold tracking-tighter uppercase mt-1">Available connections</p>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => navigateTo('search-view')} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all">🔍</button>
                              <button onClick={() => window.clearLiveTracking && window.clearLiveTracking()} className="w-10 h-10 rounded-xl bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center border border-red-500/20 transition-all">✕</button>
                          </div>
                      </div>
                      <div id="loader" className="loader hidden py-20 text-center">
                          <div className="w-12 h-12 border-4 border-[hsl(262_83%_58%)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                          <p className="text-white/40 font-bold text-xs uppercase tracking-widest">Optimizing Routes</p>
                      </div>
                      <div id="results" className="overflow-y-auto flex-1 pr-2 space-y-6 custom-scrollbar"></div>
                  </section>

                  <div className="border border-white/10 rounded-[2.5rem] overflow-hidden flex-1 h-[40vh] md:h-full relative shadow-2xl bg-black/20 group">
                      <div className="map-header absolute top-6 left-6 right-6 z-[400] flex justify-between items-center pointer-events-none">
                          <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-6 py-3 rounded-2xl pointer-events-auto">
                            <h2 className="text-lg font-bold m-0 text-white flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                Real-time Grid
                            </h2>
                          </div>
                          <button id="theme-toggle" className="pointer-events-auto bg-black/60 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 text-sm font-bold hover:bg-white/10 transition-all" onClick={() => window.toggleMapTheme && window.toggleMapTheme()}>🌞 OUTDOOR</button>
                      </div>
                      <div id="map" className="w-full h-full grayscale-[0.2] contrast-[1.1]"></div>
                  </div>
              </div>
          </motion.section>
        )}

        {activeSection === 'contact-view' && (
          <motion.section 
            key="contact-view"
            custom={getDirection('contact-view')}
            variants={sectionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="fixed inset-0 w-full h-screen flex items-center justify-center px-4 z-20 pt-20"
          >
             <TiltCard className="w-full max-w-xl border border-white/10 rounded-[2rem] bg-black/40 backdrop-blur-3xl p-10 shadow-2xl">
                <button className="text-[hsl(262_83%_58%)] text-xs font-bold uppercase tracking-widest mb-6 hover:tracking-[0.2em] transition-all" onClick={() => navigateTo('landing')}>← Back to Main</button>
                <h2 className="text-4xl font-bold mb-8">Reach Out</h2>
                <div className="space-y-6">
                  <div className="field">
                    <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block">Identity</label>
                    <input type="text" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] transition-all outline-none" placeholder="Your name" />
                  </div>
                  <div className="field">
                    <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block">Channel</label>
                    <input type="email" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] transition-all outline-none" placeholder="email@provider.com" />
                  </div>
                  <div className="field">
                    <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block">Intelligence</label>
                    <textarea rows="4" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] transition-all outline-none resize-none" placeholder="What's on your mind?"></textarea>
                  </div>
                  <button className="w-full py-5 bg-white text-black font-black rounded-2xl hover:scale-105 transition-all shadow-xl uppercase tracking-widest">Send Transmission</button>
                </div>
             </TiltCard>
          </motion.section>
        )}

        {activeSection === 'about-view' && (
          <motion.section 
            key="about-view"
            custom={getDirection('about-view')}
            variants={sectionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="fixed inset-0 w-full h-screen flex items-center justify-center px-4 z-20 pt-20"
          >
             <TiltCard className="w-full max-w-xl border border-white/10 rounded-[2rem] bg-black/40 backdrop-blur-3xl p-10 shadow-2xl">
                <button className="text-[hsl(262_83%_58%)] text-xs font-bold uppercase tracking-widest mb-6 hover:tracking-[0.2em] transition-all" onClick={() => navigateTo('landing')}>← Back to Main</button>
                <h2 className="text-4xl font-bold mb-8">System Architecture</h2>
                <div className="space-y-6">
                   {[
                     { label: 'Intelligence Core', value: 'Node.js + Groq AI' },
                     { label: 'Neural Grid', value: 'MongoDB Atlas' },
                     { label: 'Spatial Engine', value: 'Leaflet Real-time' },
                     { label: 'Interface Layer', value: 'React + Framer Motion' },
                     { label: 'Simulation', value: 'OSRM Route Snapping' }
                   ].map((item, i) => (
                     <div key={i} className="flex justify-between items-center p-4 rounded-2xl bg-white/5 border border-white/5">
                       <span className="text-white/40 text-xs font-bold uppercase tracking-widest">{item.label}</span>
                       <span className="text-white font-bold">{item.value}</span>
                     </div>
                   ))}
                </div>
             </TiltCard>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Global Elements */}
      <button 
        id="ai-assistant-btn" 
        className="fixed bottom-8 right-8 w-16 h-16 bg-[hsl(262_83%_58%)] rounded-full shadow-[0_0_40px_rgba(170,59,255,0.6)] z-[2000] flex items-center justify-center text-3xl hover:scale-110 active:scale-95 transition-all"
        onClick={() => {
            const chat = document.getElementById("ai-chat-window");
            if(chat) chat.classList.toggle("hidden");
        }}
      >
        🤖
      </button>
      
      <div id="ai-chat-window" className="hidden fixed bottom-28 right-8 w-[400px] h-[600px] rounded-[2rem] border border-white/10 bg-black/60 backdrop-blur-3xl shadow-2xl z-[2000] flex flex-col overflow-hidden">
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
              <div>
                <h3 className="m-0 text-xl font-bold">Transit AI</h3>
                <p className="text-[10px] text-[hsl(262_83%_58%)] font-black uppercase tracking-widest">Active Intelligence</p>
              </div>
              <button className="text-white/40 hover:text-white text-2xl" onClick={() => document.getElementById("ai-chat-window").classList.add("hidden")}>×</button>
          </div>
          <div id="ai-chat-messages" className="flex-1 p-6 overflow-y-auto space-y-6 custom-scrollbar">
              <div className="bg-[hsl(262_83%_58%)]/20 border border-[hsl(262_83%_58%)]/30 p-5 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm">
                Ask me about routes, schedules, or live bus locations. I'm connected to the real-time grid.
              </div>
          </div>
          <form id="ai-chat-form" className="p-6 bg-white/5 border-t border-white/10 flex gap-3" onSubmit={(e) => e.preventDefault()}>
              <input id="ai-chat-input" type="text" className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:border-[hsl(262_83%_58%)] outline-none transition-all" placeholder="Ask intelligence..." />
              <button type="submit" className="bg-[hsl(262_83%_58%)] px-8 py-4 rounded-2xl text-sm font-bold hover:bg-[hsl(262_83%_65%)] transition-all shadow-lg">SEND</button>
          </form>
      {/* Admin Modal */}
      <AnimatePresence>
        {isAdminOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <TiltCard className="w-full max-w-lg border border-white/10 rounded-[2rem] bg-black/60 backdrop-blur-3xl p-10 shadow-2xl overflow-hidden relative">
              <button className="absolute top-6 right-6 text-white/40 hover:text-white text-2xl" onClick={() => setIsAdminOpen(false)}>×</button>
              <div id="admin-modal-content">
                  <h2 className="text-3xl font-bold mb-2">System Override</h2>
                  <p className="text-xs text-[hsl(262_83%_58%)] font-black uppercase tracking-widest mb-8">God Mode Authorization</p>
                  
                  <div className="space-y-6">
                    <div className="field">
                      <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block">Admin ID</label>
                      <input type="text" id="admin-user" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] transition-all outline-none" placeholder="Identify yourself" />
                    </div>
                    <div className="field">
                      <label className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2 block">Passcode</label>
                      <input type="password" id="admin-pass" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:bg-white/10 focus:border-[hsl(262_83%_58%)] transition-all outline-none" placeholder="••••••••" />
                    </div>
                    <button className="w-full py-5 bg-[hsl(262_83%_58%)] text-white font-black rounded-2xl hover:bg-[hsl(262_83%_65%)] transition-all shadow-xl uppercase tracking-widest" onClick={() => window.loginAdmin && window.loginAdmin()}>Access Mainframe</button>
                  </div>

                  <div id="admin-terminal" className="hidden mt-8 p-4 bg-black/60 border border-white/5 rounded-xl h-[200px] overflow-y-auto font-mono text-[10px] text-green-500/80 custom-scrollbar">
                    {/* Terminal logs injected by script.js */}
                  </div>
              </div>
            </TiltCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
