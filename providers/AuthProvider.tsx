import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
} from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isInitialized: boolean;
}

type AuthAction =
  | { type: "INITIALIZED"; session: Session | null }
  | { type: "SESSION_CHANGED"; session: Session | null }
  | { type: "PROFILE_LOADED"; profile: Profile }
  | { type: "SIGNED_OUT" };

const initialState: AuthState = {
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isInitialized: false,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "INITIALIZED":
      return {
        ...state,
        session: action.session,
        user: action.session?.user ?? null,
        isLoading: action.session !== null, // still loading if we need profile
        isInitialized: true,
      };
    case "SESSION_CHANGED":
      if (!action.session) {
        return {
          ...state,
          session: null,
          user: null,
          profile: null,
          isLoading: false,
        };
      }
      return {
        ...state,
        session: action.session,
        user: action.session.user,
        isLoading: true, // need to re-fetch profile
      };
    case "PROFILE_LOADED":
      return { ...state, profile: action.profile, isLoading: false };
    case "SIGNED_OUT":
      return { ...initialState, isLoading: false, isInitialized: true };
    default:
      return state;
  }
}

interface AuthContextValue extends AuthState {
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ error: string | null }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (!error && data) {
      dispatch({ type: "PROFILE_LOADED", profile: data as Profile });
    } else {
      // Profile not found — might not be created yet by trigger
      dispatch({
        type: "PROFILE_LOADED",
        profile: {
          id: userId,
          email: "",
          display_name: "",
          avatar_url: null,
          created_at: "",
          updated_at: "",
        },
      });
    }
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      dispatch({ type: "INITIALIZED", session });
      if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch({ type: "SESSION_CHANGED", session });
      if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      return { error: error?.message ?? null };
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error?.message ?? null };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    dispatch({ type: "SIGNED_OUT" });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (state.user) {
      await loadProfile(state.user.id);
    }
  }, [state.user, loadProfile]);

  return (
    <AuthContext.Provider
      value={{ ...state, signUp, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
